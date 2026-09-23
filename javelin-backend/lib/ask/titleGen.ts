import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { sql } from '../db';
import { truncateTitle } from './truncateTitle';

// Defensive baseURL — see feedback_anthropic_base_url_leakage.md.
const anthropic = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

/**
 * Generate a brief title for a thread by sampling its first user+assistant
 * exchange and asking Haiku for a short summary. Persists to threads.title
 * with a NULL-guard so parallel calls don't overwrite.
 *
 * Fire-and-forget from /api/ask onFinish — failures should be logged by the
 * caller, not raised. Safe to call multiple times for the same thread; the
 * NULL-guard makes subsequent runs no-ops once a title is set. This is the
 * self-healing mechanism per Decision G3 — every assistant insert that lands
 * on a still-untitled thread re-fires this until a title sticks.
 *
 * Uses generateText (not streamText) since titles are ~10 tokens — no
 * streaming benefit, simpler code, lower overhead.
 */
export async function generateTitleAndPersist(threadId: string): Promise<void> {
  // Pull first 2 messages — the first user message + first assistant response.
  const rows = (await sql`
    SELECT role, content
    FROM messages
    WHERE thread_id = ${threadId}
    ORDER BY created_at ASC
    LIMIT 2
  `) as Array<{ role: string; content: string }>;

  if (rows.length < 2) {
    // Not enough context yet (e.g., assistant insert hasn't completed).
    // Self-heal will retry on next turn.
    return;
  }

  const conversationSnippet = rows
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const { text } = await generateText({
    model: anthropic('claude-haiku-4-5-20251001'),
    messages: [
      {
        role: 'system',
        content:
          'Generate a brief thread title — maximum 5 words and 40 characters total. Be punchy. Skip articles when possible. Return only the title text — no quotes, no preamble, no trailing punctuation.',
      },
      {
        role: 'user',
        content: conversationSnippet,
      },
    ],
  });

  // Defense-in-depth: if the LLM ignores the 40-char cap, truncate at the
  // last word boundary so we never ship a mid-word cut like "Collaps".
  const title = truncateTitle(text, 40);

  // NULL-guard: only set title if it's still null. Prevents parallel calls
  // from overwriting each other; matches G3 self-healing semantics.
  await sql`
    UPDATE threads
    SET title = ${title}
    WHERE thread_id = ${threadId}
      AND title IS NULL
  `;
}
