// V3 stream parser for /api/ask responses.
//
// AI SDK v6 returns text/event-stream (SSE) with `data: <json>\n\n` events
// from `result.toUIMessageStreamResponse()`. Each event JSON has a `type`
// discriminator. Header: `x-vercel-ai-ui-message-stream: v1`.
//
// Callback API (not async generator): Stripe Apps CLI's bundled esbuild
// pins a target ("es2016") that doesn't support `async function*` transform,
// and the target can't be overridden via tsconfig. Callback pattern compiles
// cleanly and is functionally equivalent for our use.

export type AskEvent =
  | { type: 'start' }
  | { type: 'start-step' }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'tool-input-start'; toolCallId: string; toolName: string }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | { type: 'tool-input-available'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-output-available'; toolCallId: string; output: unknown }
  | { type: 'tool-output-error'; toolCallId: string; errorText: string }
  | { type: 'tool-output-denied'; toolCallId: string }
  | { type: 'finish-step' }
  | { type: 'finish' }
  | { type: 'error'; errorText: string };

/** Reads the SSE stream from /api/ask and fires `onEvent` per successfully-parsed
 *  event. Resolves when the stream completes. Parse errors on individual lines
 *  are silently skipped (defensive — partial chunks happen at TCP boundaries). */
export async function parseAskStream(
  response: Response,
  onEvent: (event: AskEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error('Response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handle = (jsonStr: string) => {
    if (!jsonStr || jsonStr === '[DONE]') return;
    try {
      const event = JSON.parse(jsonStr);
      if (event && typeof event.type === 'string') {
        onEvent(event as AskEvent);
      }
    } catch {
      // Partial chunk or non-JSON line — skip
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trimEnd();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      handle(line.startsWith('data:') ? line.slice(5).trim() : line);
    }
  }

  // Flush trailing buffer (no terminating newline)
  const tail = buffer.trim();
  if (tail) {
    handle(tail.startsWith('data:') ? tail.slice(5).trim() : tail);
  }
}
