// Single eval runner: takes a question string, runs it through the real V3
// system prompt + tools (with fetchers vi.mock'd at the test-file level),
// drains the stream, returns a structured result for assertions.
//
// Mirrors the production /api/ask route's streamText invocation so evals
// exercise the same code path.

import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, stepCountIs } from 'ai';
import { buildSystemPrompt } from '../lib/ask/systemPrompt';
import { buildTools } from '../lib/ask/tools';
import { FIXTURE_PROFILE } from './profileFixture';
import { FROZEN_NOW_ISO } from './fetcherFixtures';

// Defensive baseURL — see feedback_anthropic_base_url_leakage memory.
const anthropic = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

// Account ID is irrelevant here — fetchers are mocked, so this string just
// satisfies the buildTools signature and shows up in console logs if anything
// slips through to a real Stripe call (which would then fail loudly).
const EVAL_ACCOUNT_ID = 'acct_eval_test';

export interface EvalToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface EvalRunResult {
  toolCalls: EvalToolCall[]; // in call order across all steps
  answerText: string;        // concatenated text-deltas from final composition step
  rawSteps: unknown[];       // full trajectory for debugging when an eval fails
}

export async function runEval(question: string): Promise<EvalRunResult> {
  const todayISO = FROZEN_NOW_ISO.split('T')[0]; // 2026-04-29

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(FIXTURE_PROFILE),
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      },
      {
        role: 'system',
        content: `Today's date is ${todayISO}. Use this as the reference when converting date-relative phrasings ("last month", "this week", "Q1 2026", etc.) to ISO date inputs for tool calls.`,
      },
      { role: 'user', content: question },
    ],
    tools: buildTools(EVAL_ACCOUNT_ID, FIXTURE_PROFILE),
    stopWhen: stepCountIs(6),
  });

  // Drain the stream to completion before reading steps.
  for await (const _ of result.textStream) {
    /* drain */
  }

  const steps = await result.steps;

  const toolCalls: EvalToolCall[] = [];
  let answerText = '';
  for (const step of steps) {
    for (const part of step.content) {
      if (part.type === 'tool-call') {
        toolCalls.push({
          name: part.toolName,
          input: part.input as Record<string, unknown>,
        });
      } else if (part.type === 'text') {
        answerText += part.text;
      }
    }
  }

  return { toolCalls, answerText, rawSteps: steps };
}
