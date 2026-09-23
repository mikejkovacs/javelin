import { sql } from '../db';

/** Idempotent thread upsert. Safe to call on every threaded /api/ask. */
export async function upsertThread(
  threadId: string,
  accountId: string,
): Promise<void> {
  await sql`
    INSERT INTO threads (thread_id, account_id)
    VALUES (${threadId}, ${accountId})
    ON CONFLICT (thread_id) DO NOTHING
  `;
}

/**
 * Returns thread metadata if owned by accountId and not deleted, else null.
 * Used both to verify ownership (defends against thread_id collisions across
 * accounts) and to detect first-turn (title === null) for title-gen gating.
 */
export async function getThreadOwnership(
  threadId: string,
  accountId: string,
): Promise<{ title: string | null } | null> {
  const rows = (await sql`
    SELECT title FROM threads
    WHERE thread_id = ${threadId}
      AND account_id = ${accountId}
      AND deleted_at IS NULL
  `) as Array<{ title: string | null }>;
  if (rows.length === 0) return null;
  return { title: rows[0].title ?? null };
}

/**
 * Insert a user message. Returns true on insert, false on duplicate
 * message_id. Caller maps false → 409 per Decision H (strict reject).
 */
export async function insertUserMessage(
  threadId: string,
  messageId: string,
  content: string,
): Promise<boolean> {
  const result = (await sql`
    INSERT INTO messages (message_id, thread_id, role, content)
    VALUES (${messageId}, ${threadId}, 'user', ${content})
    ON CONFLICT (message_id) DO NOTHING
    RETURNING message_id
  `) as Array<{ message_id: string }>;
  return result.length > 0;
}

/**
 * Persist an assistant turn. The full `responseMessages` array (from
 * AI SDK's onFinish event.response.messages) is stored as JSONB so the
 * next turn can hydrate it back into streamText without reconstruction.
 * `text` mirrors the final visible response for UI display + thread list.
 */
export async function insertAssistantMessage(
  threadId: string,
  text: string,
  responseMessages: unknown,
  telemetry: {
    cacheCreationTokens: number | null;
    cacheReadTokens: number | null;
    outputTokens: number | null;
  },
): Promise<void> {
  const messageId = `asst_${crypto.randomUUID()}`;
  await sql`
    INSERT INTO messages (
      message_id, thread_id, role, content, tool_calls,
      cache_creation_tokens, cache_read_tokens, output_tokens
    )
    VALUES (
      ${messageId}, ${threadId}, 'assistant', ${text},
      ${JSON.stringify(responseMessages)},
      ${telemetry.cacheCreationTokens},
      ${telemetry.cacheReadTokens},
      ${telemetry.outputTokens}
    )
  `;
}

/** Bump last_active_at to NOW() — called on user-msg insert AND in onFinish. */
export async function touchThread(threadId: string): Promise<void> {
  await sql`
    UPDATE threads SET last_active_at = NOW() WHERE thread_id = ${threadId}
  `;
}

/**
 * Rebuild the AI SDK message array for a thread from persisted rows.
 * User rows yield {role:'user', content:string}. Assistant rows yield the
 * persisted response.messages array directly (which is AI-SDK-formatted —
 * may include AssistantModelMessage + ToolModelMessage entries for tool
 * calls/results). The latter preserves tool-call fidelity so referential
 * follow-ups ("expand that table") can resolve against prior tool data.
 */
export async function hydrateThreadMessages(
  threadId: string,
): Promise<unknown[]> {
  const rows = (await sql`
    SELECT role, content, tool_calls
    FROM messages
    WHERE thread_id = ${threadId}
    ORDER BY created_at ASC
  `) as Array<{ role: string; content: string; tool_calls: unknown }>;

  const aiSdkMessages: unknown[] = [];
  for (const row of rows) {
    if (row.role === 'user') {
      aiSdkMessages.push({ role: 'user', content: row.content });
    } else {
      // Assistant turn — replay persisted AI-SDK-formatted messages directly.
      const persisted = row.tool_calls;
      if (Array.isArray(persisted) && persisted.length > 0) {
        aiSdkMessages.push(...persisted);
      } else {
        // Fallback for rows without serialized response (defensive — should
        // not happen in normal flow): treat as plain assistant text.
        aiSdkMessages.push({ role: 'assistant', content: row.content });
      }
    }
  }
  return aiSdkMessages;
}

/**
 * Returns true if thread exists and its title is NULL. Used to gate the
 * title-gen sidecar — fires on every assistant insert until title is set.
 * Self-healing per Decision G3: a transient title-gen failure on turn 1
 * gets retried on turn 2.
 */
export async function threadStillUntitled(threadId: string): Promise<boolean> {
  const rows = (await sql`
    SELECT title FROM threads WHERE thread_id = ${threadId}
  `) as Array<{ title: string | null }>;
  if (rows.length === 0) return false;
  return rows[0].title === null;
}
