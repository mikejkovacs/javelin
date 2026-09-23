export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Tool names used to produce this assistant message. Surfaced as
   *  "Sources: ..." caption via citation-label registry. Undefined when
   *  no tools ran (pure-conversation answers) OR when the assistant
   *  message is hydrated from a row without parseable tool_calls JSONB. */
  toolsUsed?: string[];
}

export interface ThreadSummary {
  thread_id: string;
  title: string | null;
  created_at: string;
  last_active_at: string;
}

export type Stage = 'idle' | 'streaming';

export interface ThreadState {
  /** null = new conversation (no thread persisted yet). When user sends
   *  the first message, handleSubmit generates a fresh thread_id and
   *  uses it in the request. */
  activeThreadId: string | null;
  /** Active thread's messages — rendered in ConversationView. */
  messages: Message[];
  /** Thread list — loaded on mount, refreshed after stream + on delete. */
  threads: ThreadSummary[];
  /** Stream state. */
  stage: Stage;
  /** Currently displayed shimmer line — chip preferred when set, else
   *  shimmer phrase. Single-line render in App.tsx (Tier-2 phase shimmer). */
  currentChip: string | null;
  currentShimmer: string | null;
  /** C-3: "All conversations" FocusView open state. */
  allConvOpen: boolean;
  /** C-3: search query inside the FocusView. */
  searchQuery: string;
  /** C-3: thread targeted for delete confirmation (Banner shown when set). */
  pendingDelete: ThreadSummary | null;
}

export const initialState: ThreadState = {
  activeThreadId: null,
  messages: [],
  threads: [],
  stage: 'idle',
  currentChip: null,
  currentShimmer: null,
  allConvOpen: false,
  searchQuery: '',
  pendingDelete: null,
};

export type Action =
  | { type: 'THREADS_LOADED'; threads: ThreadSummary[] }
  | { type: 'THREAD_SELECTED'; threadId: string; messages: Message[] }
  | { type: 'THREAD_RESET' }
  | { type: 'MESSAGE_SUBMITTED'; userMsg: Message; threadId: string }
  | { type: 'CHIP_SET'; chip: string | null }
  | { type: 'SHIMMER_SET'; shimmer: string | null }
  | { type: 'TEXT_DELTA'; delta: string }
  | { type: 'TOOLS_USED'; tools: string[] }
  | { type: 'STREAM_FINISHED' }
  | { type: 'STREAM_ERROR'; detail: string }
  | { type: 'ALL_CONV_TOGGLED'; open: boolean }
  | { type: 'SEARCH_UPDATED'; query: string }
  | { type: 'PENDING_DELETE_SET'; thread: ThreadSummary }
  | { type: 'PENDING_DELETE_CLEARED' }
  | { type: 'THREAD_DELETED'; threadId: string };

export function threadReducer(state: ThreadState, action: Action): ThreadState {
  switch (action.type) {
    case 'THREADS_LOADED':
      return { ...state, threads: action.threads };

    case 'THREAD_SELECTED':
      return {
        ...state,
        activeThreadId: action.threadId,
        messages: action.messages,
        stage: 'idle',
        currentChip: null,
        currentShimmer: null,
        // C-3: switching threads also closes the FocusView and clears any
        // pending delete confirmation — clean slate for the new thread.
        allConvOpen: false,
        pendingDelete: null,
      };

    case 'THREAD_RESET':
      return {
        ...state,
        activeThreadId: null,
        messages: [],
        stage: 'idle',
        currentChip: null,
        currentShimmer: null,
      };

    case 'MESSAGE_SUBMITTED':
      return {
        ...state,
        activeThreadId: action.threadId,
        messages: [
          ...state.messages,
          action.userMsg,
          { role: 'assistant', content: '' },
        ],
        stage: 'streaming',
      };

    case 'CHIP_SET':
      return { ...state, currentChip: action.chip };

    case 'SHIMMER_SET':
      return { ...state, currentShimmer: action.shimmer };

    case 'TEXT_DELTA': {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') {
        messages[messages.length - 1] = {
          ...last,
          content: last.content + action.delta,
        };
      }
      return {
        ...state,
        messages,
        currentChip: null,
        currentShimmer: null,
      };
    }

    case 'TOOLS_USED': {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') {
        // Dedupe — same tool called multiple times appears once in the caption.
        const existing = new Set(last.toolsUsed ?? []);
        for (const t of action.tools) existing.add(t);
        messages[messages.length - 1] = {
          ...last,
          toolsUsed: Array.from(existing),
        };
      }
      return { ...state, messages };
    }

    case 'STREAM_FINISHED':
      return {
        ...state,
        stage: 'idle',
        currentChip: null,
        currentShimmer: null,
      };

    case 'STREAM_ERROR': {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant' && !last.content) {
        messages[messages.length - 1] = {
          role: 'assistant',
          content: `Something went wrong. ${action.detail}`,
        };
      } else {
        messages.push({
          role: 'assistant',
          content: `Something went wrong. ${action.detail}`,
        });
      }
      return {
        ...state,
        messages,
        stage: 'idle',
        currentChip: null,
        currentShimmer: null,
      };
    }

    case 'ALL_CONV_TOGGLED':
      // On close: clear search + pending delete so reopen has a clean slate.
      return {
        ...state,
        allConvOpen: action.open,
        ...(action.open
          ? {}
          : { searchQuery: '', pendingDelete: null }),
      };

    case 'SEARCH_UPDATED':
      return { ...state, searchQuery: action.query };

    case 'PENDING_DELETE_SET':
      return { ...state, pendingDelete: action.thread };

    case 'PENDING_DELETE_CLEARED':
      return { ...state, pendingDelete: null };

    case 'THREAD_DELETED': {
      const remaining = state.threads.filter(
        (t) => t.thread_id !== action.threadId,
      );
      const wasActive = state.activeThreadId === action.threadId;
      return {
        ...state,
        threads: remaining,
        // If the active thread was deleted, fall back to new-conversation state.
        activeThreadId: wasActive ? null : state.activeThreadId,
        messages: wasActive ? [] : state.messages,
        pendingDelete: null,
      };
    }
  }
}
