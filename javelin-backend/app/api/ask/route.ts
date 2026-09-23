import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, stepCountIs } from 'ai';
import { NextRequest } from 'next/server';
import {
  verifyAndGetAccountId,
  SignatureVerificationError,
} from '../../../lib/auth';
import { buildSystemPrompt } from '../../../lib/ask/systemPrompt';
import { buildTools } from '../../../lib/ask/tools';
import type { Profile } from '../../../lib/profile';
import {
  upsertThread,
  getThreadOwnership,
  insertUserMessage,
  insertAssistantMessage,
  touchThread,
  hydrateThreadMessages,
  threadStillUntitled,
} from '../../../lib/ask/persistence';
import { generateTitleAndPersist } from '../../../lib/ask/titleGen';
import { logTiming } from '../../../lib/ask/timing';

export const runtime = 'edge';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
};

// Defensive baseURL — see feedback_anthropic_base_url_leakage.md.
const anthropic = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  // Latency instrumentation — see lib/ask/timing.ts. We emit one log line
  // per milestone so a single grep of '[TIMING]' on a Vercel log slice
  // reconstructs the request's wall-clock breakdown. Cold-path debug for
  // the Merchant B 3-4 min first-question observation (2026-05-12).
  const t0 = Date.now();
  logTiming('request_start', { path: '/api/ask' });

  let verified;
  try {
    verified = await verifyAndGetAccountId(req);
  } catch (err) {
    if (err instanceof SignatureVerificationError) {
      console.error(
        '[auth] /api/ask signature verification failed:',
        err.reason,
        err.message,
      );
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    console.error('[auth] /api/ask internal error during verification:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  logTiming('auth_done', {
    account_id: verified.accountId,
    duration_ms: Date.now() - t0,
  });

  // Branch on body shape. New threaded body has `thread_id`; legacy body
  // has `messages`. Legacy path will be removed in cleanup once Stage C
  // frontend migration is in production.
  const body = verified.body as Record<string, unknown>;
  if (typeof body.thread_id === 'string') {
    return handleThreadedAsk(verified.accountId, body, t0);
  }
  return handleLegacyAsk(verified.accountId, body, t0);
}

// Today's date as a non-cached system message. Sits AFTER the cached prefix
// so it doesn't break daily caching, but BEFORE user messages so the LLM
// treats it as authoritative for date-relative phrasing ("last month", etc.).
function buildSystemPromptMessages(profile: Profile | null) {
  const todayISO = new Date().toISOString().split('T')[0];
  return [
    {
      role: 'system' as const,
      content: buildSystemPrompt(profile),
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    },
    {
      role: 'system' as const,
      content: `Today's date is ${todayISO}. Use this as the reference when converting date-relative phrasings ("last month", "this week", "Q1 2026", etc.) to ISO date inputs for tool calls.`,
    },
  ];
}

// LEGACY path — pre-Stage-C frontend. Stateless: messages array travels
// in the body, no persistence. Removed in cleanup PR after Stage C ships
// and production traffic is fully on the threaded path.
function handleLegacyAsk(
  accountId: string,
  body: Record<string, unknown>,
  t0: number,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages = (body.messages ?? []) as any[];
  const profile = (body.profile ?? null) as Profile | null;

  logTiming('stream_started', {
    account_id: accountId,
    path: 'legacy',
    duration_ms: Date.now() - t0,
  });

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    messages: [...buildSystemPromptMessages(profile), ...messages],
    tools: buildTools(accountId, profile ?? undefined),
    stopWhen: stepCountIs(6),
    onError: ({ error }) => {
      console.error('[Javelin] /api/ask stream failed:', error);
    },
    onFinish: ({ steps, totalUsage }) => {
      logTiming('request_end', {
        account_id: accountId,
        path: 'legacy',
        duration_ms: Date.now() - t0,
        steps: steps.length,
        cache_create_tokens: totalUsage?.inputTokenDetails?.cacheWriteTokens ?? null,
        cache_read_tokens: totalUsage?.inputTokenDetails?.cacheReadTokens ?? null,
        output_tokens: totalUsage?.outputTokens ?? null,
      });
      console.log(
        '[Javelin] /api/ask trajectory:',
        JSON.stringify(steps, null, 2),
      );
    },
  });

  return result.toUIMessageStreamResponse({ headers: corsHeaders });
}

// THREADED path — Stage B. Persists to Neon, supports multi-turn,
// fires title-gen sidecar on first turn (self-healing per Decision G3).
async function handleThreadedAsk(
  accountId: string,
  body: Record<string, unknown>,
  t0: number,
) {
  const threadId = body.thread_id as string;
  const messageId = body.message_id;
  const content = body.content;
  const profile = (body.profile ?? null) as Profile | null;

  if (typeof messageId !== 'string' || messageId.length === 0) {
    return Response.json(
      { error: 'invalid_body', detail: 'message_id required' },
      { status: 400, headers: corsHeaders },
    );
  }
  if (typeof content !== 'string' || content.length === 0) {
    return Response.json(
      { error: 'invalid_body', detail: 'content required' },
      { status: 400, headers: corsHeaders },
    );
  }

  try {
    // Implicit thread upsert (idempotent).
    await upsertThread(threadId, accountId);

    // Verify ownership — defends against thread_id collision across accounts.
    // 404 not 403 to avoid leaking thread existence cross-account.
    const thread = await getThreadOwnership(threadId, accountId);
    if (!thread) {
      return Response.json(
        { error: 'not_found' },
        { status: 404, headers: corsHeaders },
      );
    }

    // Insert user message — strict reject on duplicate per Decision H.
    const inserted = await insertUserMessage(threadId, messageId, content);
    if (!inserted) {
      return Response.json(
        { error: 'duplicate_message_id' },
        { status: 409, headers: corsHeaders },
      );
    }

    // Bump last_active_at on user-msg insert per Decision I (also bumped
    // again in onFinish after the assistant response).
    await touchThread(threadId);

    // Hydrate full message history for streamText. The hydrated array
    // includes the user message we just inserted.
    const aiSdkMessages = await hydrateThreadMessages(threadId);

    logTiming('db_setup_done', {
      account_id: accountId,
      thread_id: threadId,
      message_id: messageId,
      message_count: aiSdkMessages.length,
      profile_present: profile != null,
      duration_ms: Date.now() - t0,
    });

    logTiming('stream_started', {
      account_id: accountId,
      thread_id: threadId,
      path: 'threaded',
      duration_ms: Date.now() - t0,
    });

    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      messages: [
        ...buildSystemPromptMessages(profile),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(aiSdkMessages as any[]),
      ],
      tools: buildTools(accountId, profile ?? undefined),
      stopWhen: stepCountIs(6),
      onError: ({ error }) => {
        console.error('[Javelin] /api/ask threaded stream failed:', error);
      },
      onFinish: async (event) => {
        try {
          // Persist assistant turn — full response.messages array stored
          // as JSONB so next-turn hydration gets faithful tool-call replay.
          await insertAssistantMessage(
            threadId,
            event.text,
            event.response.messages,
            {
              cacheCreationTokens:
                event.totalUsage.inputTokenDetails?.cacheWriteTokens ?? null,
              cacheReadTokens:
                event.totalUsage.inputTokenDetails?.cacheReadTokens ?? null,
              outputTokens: event.totalUsage.outputTokens ?? null,
            },
          );

          // Bump last_active_at again per Decision I.
          await touchThread(threadId);

          // Title-gen sidecar — fires while title is still NULL. Self-heals
          // on transient failure: any subsequent turn that lands on a still-
          // untitled thread re-fires this until a title sticks.
          //
          // AWAITED (not fire-and-forget): Vercel Edge runtime cancels
          // pending Promises once onFinish returns and the response stream
          // closes — a fire-and-forget call would die mid-Anthropic-call
          // and never persist. Awaiting keeps the function context alive
          // until title-gen completes; user-visible response was already
          // sent before onFinish started, so this doesn't delay UX.
          if (await threadStillUntitled(threadId)) {
            try {
              await generateTitleAndPersist(threadId);
            } catch (err) {
              console.error(
                '[title-gen] failed for thread',
                threadId,
                err,
              );
            }
          }

          logTiming('request_end', {
            account_id: accountId,
            thread_id: threadId,
            path: 'threaded',
            duration_ms: Date.now() - t0,
            steps: event.steps.length,
            cache_create_tokens:
              event.totalUsage.inputTokenDetails?.cacheWriteTokens ?? null,
            cache_read_tokens:
              event.totalUsage.inputTokenDetails?.cacheReadTokens ?? null,
            output_tokens: event.totalUsage.outputTokens ?? null,
          });

          console.log(
            '[Javelin] /api/ask threaded trajectory:',
            JSON.stringify(event.steps, null, 2),
          );
        } catch (err) {
          // Persistence failure shouldn't surface to the user — the
          // response has already streamed back. Log for debugging.
          console.error(
            '[Javelin] /api/ask threaded persistence failed:',
            err,
          );
        }
      },
    });

    return result.toUIMessageStreamResponse({ headers: corsHeaders });
  } catch (err) {
    console.error('[Javelin] /api/ask threaded internal error:', err);
    return Response.json(
      { error: 'internal_error' },
      { status: 500, headers: corsHeaders },
    );
  }
}
