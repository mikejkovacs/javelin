import type { SignedFetch } from './signedFetch';
import type { Message, ThreadSummary } from '../state/threadReducer';

const ASK_URL = 'https://javelin-backend.vercel.app/api/ask';
const THREADS_LIST_URL = 'https://javelin-backend.vercel.app/api/threads/list';
const THREADS_GET_URL = 'https://javelin-backend.vercel.app/api/threads/get';
const THREADS_DELETE_URL =
  'https://javelin-backend.vercel.app/api/threads/delete';

export interface ApiClient {
  listThreads(): Promise<ThreadSummary[]>;
  getThread(
    threadId: string,
  ): Promise<{ thread: ThreadSummary; messages: Message[] }>;
  deleteThread(threadId: string): Promise<void>;
}

/**
 * Walk the persisted `tool_calls` JSONB (which stores the AI SDK
 * `response.messages` array shape from the prior turn) and extract the
 * tool names that were called. Used on hydrate to populate the
 * "Sources: ..." caption for hydrated assistant messages.
 *
 * Returns undefined when:
 *   - tool_calls is null/missing (pure conversational answer)
 *   - tool_calls has unexpected shape (older messages, schema drift)
 *   - no tool-call parts found
 *
 * Defensive: any parse failure → return undefined → caption just doesn't
 * render. Never throws.
 */
function extractToolsUsed(toolCalls: unknown): string[] | undefined {
  if (!Array.isArray(toolCalls)) return undefined;
  const tools = new Set<string>();
  for (const msg of toolCalls) {
    if (typeof msg !== 'object' || msg === null) continue;
    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const type = (part as { type?: unknown }).type;
      const toolName = (part as { toolName?: unknown }).toolName;
      if (type === 'tool-call' && typeof toolName === 'string') {
        tools.add(toolName);
      }
    }
  }
  return tools.size > 0 ? Array.from(tools) : undefined;
}

/**
 * Wraps signedFetch with typed helpers for the threads endpoints. Streaming
 * /api/ask stays in App.tsx (parseAskStream integration); only the discrete
 * request/response endpoints are wrapped here.
 */
export function makeApi(signedFetch: SignedFetch): ApiClient {
  return {
    async listThreads() {
      const res = await signedFetch(THREADS_LIST_URL, {
        method: 'POST',
        body: '{}',
      });
      if (!res.ok) throw new Error(`listThreads failed: ${res.status}`);
      const json = (await res.json()) as { threads: ThreadSummary[] };
      return json.threads;
    },

    async getThread(threadId) {
      const res = await signedFetch(THREADS_GET_URL, {
        method: 'POST',
        body: JSON.stringify({ thread_id: threadId }),
      });
      if (!res.ok) throw new Error(`getThread failed: ${res.status}`);
      const json = (await res.json()) as {
        thread: ThreadSummary;
        messages: Array<{
          role: string;
          content: string;
          tool_calls?: unknown;
        }>;
      };
      // Convert DB rows to UI Message[] — UI needs role + content +
      // (for assistant messages) toolsUsed extracted from tool_calls JSONB.
      const messages: Message[] = json.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        toolsUsed:
          m.role === 'assistant' ? extractToolsUsed(m.tool_calls) : undefined,
      }));
      return { thread: json.thread, messages };
    },

    async deleteThread(threadId) {
      const res = await signedFetch(THREADS_DELETE_URL, {
        method: 'POST',
        body: JSON.stringify({ thread_id: threadId }),
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`deleteThread failed: ${res.status}`);
      }
    },
  };
}

export const ASK_ENDPOINT = ASK_URL;
