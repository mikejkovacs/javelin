import {
  threadReducer,
  initialState,
  type ThreadState,
  type ThreadSummary,
  type Message,
} from './threadReducer';

const sampleThread = (overrides: Partial<ThreadSummary> = {}): ThreadSummary => ({
  thread_id: 'thr_abc',
  title: 'Sample',
  created_at: '2026-01-01T00:00:00Z',
  last_active_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const sampleUserMsg: Message = { role: 'user', content: 'hello' };

describe('threadReducer', () => {
  describe('THREADS_LOADED', () => {
    it('replaces threads list', () => {
      const next = threadReducer(initialState, {
        type: 'THREADS_LOADED',
        threads: [sampleThread()],
      });
      expect(next.threads).toHaveLength(1);
      expect(next.threads[0].thread_id).toBe('thr_abc');
    });
  });

  describe('THREAD_SELECTED', () => {
    it('sets active thread, replaces messages, clears stream state', () => {
      const seed: ThreadState = {
        ...initialState,
        currentChip: 'Computing MRR…',
        currentShimmer: 'consulting the llama…',
        stage: 'streaming',
      };
      const messages: Message[] = [{ role: 'user', content: 'hi' }];
      const next = threadReducer(seed, {
        type: 'THREAD_SELECTED',
        threadId: 'thr_x',
        messages,
      });
      expect(next.activeThreadId).toBe('thr_x');
      expect(next.messages).toEqual(messages);
      expect(next.stage).toBe('idle');
      expect(next.currentChip).toBeNull();
      expect(next.currentShimmer).toBeNull();
    });

    it('closes the FocusView and clears pendingDelete (C-3)', () => {
      const seed: ThreadState = {
        ...initialState,
        allConvOpen: true,
        pendingDelete: sampleThread(),
      };
      const next = threadReducer(seed, {
        type: 'THREAD_SELECTED',
        threadId: 'thr_x',
        messages: [],
      });
      expect(next.allConvOpen).toBe(false);
      expect(next.pendingDelete).toBeNull();
    });
  });

  describe('THREAD_RESET', () => {
    it('clears active thread and messages, preserves threads list', () => {
      const seed: ThreadState = {
        ...initialState,
        activeThreadId: 'thr_x',
        messages: [{ role: 'user', content: 'old' }],
        threads: [sampleThread()],
      };
      const next = threadReducer(seed, { type: 'THREAD_RESET' });
      expect(next.activeThreadId).toBeNull();
      expect(next.messages).toEqual([]);
      expect(next.threads).toHaveLength(1);
    });
  });

  describe('MESSAGE_SUBMITTED', () => {
    it('appends user message and empty assistant placeholder', () => {
      const next = threadReducer(initialState, {
        type: 'MESSAGE_SUBMITTED',
        userMsg: sampleUserMsg,
        threadId: 'thr_new',
      });
      expect(next.messages).toHaveLength(2);
      expect(next.messages[0]).toEqual(sampleUserMsg);
      expect(next.messages[1]).toEqual({
        role: 'assistant',
        content: '',
      });
    });

    it('sets activeThreadId when null (new thread)', () => {
      const next = threadReducer(initialState, {
        type: 'MESSAGE_SUBMITTED',
        userMsg: sampleUserMsg,
        threadId: 'thr_new',
      });
      expect(next.activeThreadId).toBe('thr_new');
    });

    it('preserves activeThreadId when already set', () => {
      const seed: ThreadState = {
        ...initialState,
        activeThreadId: 'thr_existing',
      };
      const next = threadReducer(seed, {
        type: 'MESSAGE_SUBMITTED',
        userMsg: sampleUserMsg,
        threadId: 'thr_existing',
      });
      expect(next.activeThreadId).toBe('thr_existing');
    });

    it('transitions stage to streaming', () => {
      const next = threadReducer(initialState, {
        type: 'MESSAGE_SUBMITTED',
        userMsg: sampleUserMsg,
        threadId: 'thr_new',
      });
      expect(next.stage).toBe('streaming');
    });
  });

  describe('CHIP_SET', () => {
    it('sets chip', () => {
      const next = threadReducer(initialState, {
        type: 'CHIP_SET',
        chip: 'Computing MRR…',
      });
      expect(next.currentChip).toBe('Computing MRR…');
    });

    it('clears chip when set to null', () => {
      const seed: ThreadState = { ...initialState, currentChip: 'x' };
      const next = threadReducer(seed, { type: 'CHIP_SET', chip: null });
      expect(next.currentChip).toBeNull();
    });
  });

  describe('SHIMMER_SET', () => {
    it('sets shimmer', () => {
      const next = threadReducer(initialState, {
        type: 'SHIMMER_SET',
        shimmer: 'thinking',
      });
      expect(next.currentShimmer).toBe('thinking');
    });
  });

  describe('TEXT_DELTA', () => {
    it('appends delta to last assistant message', () => {
      const seed: ThreadState = {
        ...initialState,
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'Hello' },
        ],
      };
      const next = threadReducer(seed, {
        type: 'TEXT_DELTA',
        delta: ' world',
      });
      expect(next.messages[1].content).toBe('Hello world');
    });

    it('clears chip and shimmer', () => {
      const seed: ThreadState = {
        ...initialState,
        currentChip: 'x',
        currentShimmer: 'y',
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: '' },
        ],
      };
      const next = threadReducer(seed, {
        type: 'TEXT_DELTA',
        delta: 'a',
      });
      expect(next.currentChip).toBeNull();
      expect(next.currentShimmer).toBeNull();
    });

    it('handles empty initial assistant content', () => {
      const seed: ThreadState = {
        ...initialState,
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: '' },
        ],
      };
      const next = threadReducer(seed, {
        type: 'TEXT_DELTA',
        delta: 'first',
      });
      expect(next.messages[1].content).toBe('first');
    });
  });

  describe('TOOLS_USED', () => {
    it('sets toolsUsed on the last assistant message', () => {
      const seed: ThreadState = {
        ...initialState,
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'Your MRR is $125' },
        ],
      };
      const next = threadReducer(seed, {
        type: 'TOOLS_USED',
        tools: ['mrr', 'period_billed_revenue'],
      });
      expect(next.messages[1].toolsUsed).toEqual([
        'mrr',
        'period_billed_revenue',
      ]);
    });

    it('dedupes when same tool name appears multiple times', () => {
      const seed: ThreadState = {
        ...initialState,
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'answer' },
        ],
      };
      const next = threadReducer(seed, {
        type: 'TOOLS_USED',
        tools: ['mrr', 'mrr', 'churn_rate', 'mrr'],
      });
      expect(next.messages[1].toolsUsed).toEqual(['mrr', 'churn_rate']);
    });

    it('merges with existing toolsUsed without duplicating', () => {
      const seed: ThreadState = {
        ...initialState,
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            content: 'answer',
            toolsUsed: ['mrr'],
          },
        ],
      };
      const next = threadReducer(seed, {
        type: 'TOOLS_USED',
        tools: ['mrr', 'churn_rate'],
      });
      expect(next.messages[1].toolsUsed).toEqual(['mrr', 'churn_rate']);
    });

    it('no-ops if last message is not assistant', () => {
      const seed: ThreadState = {
        ...initialState,
        messages: [{ role: 'user', content: 'q' }],
      };
      const next = threadReducer(seed, {
        type: 'TOOLS_USED',
        tools: ['mrr'],
      });
      expect(next.messages[0]).toEqual({ role: 'user', content: 'q' });
    });
  });

  describe('STREAM_FINISHED', () => {
    it('transitions stage to idle and clears chip/shimmer', () => {
      const seed: ThreadState = {
        ...initialState,
        stage: 'streaming',
        currentChip: 'x',
        currentShimmer: 'y',
      };
      const next = threadReducer(seed, { type: 'STREAM_FINISHED' });
      expect(next.stage).toBe('idle');
      expect(next.currentChip).toBeNull();
      expect(next.currentShimmer).toBeNull();
    });
  });

  describe('STREAM_ERROR', () => {
    it('replaces empty assistant placeholder with error message', () => {
      const seed: ThreadState = {
        ...initialState,
        stage: 'streaming',
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: '' },
        ],
      };
      const next = threadReducer(seed, {
        type: 'STREAM_ERROR',
        detail: 'TypeError: x',
      });
      expect(next.messages).toHaveLength(2);
      expect(next.messages[1].content).toContain('Something went wrong');
      expect(next.messages[1].content).toContain('TypeError: x');
      expect(next.stage).toBe('idle');
    });

    it('appends new error message if last assistant has content', () => {
      const seed: ThreadState = {
        ...initialState,
        stage: 'streaming',
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'partial answer' },
        ],
      };
      const next = threadReducer(seed, {
        type: 'STREAM_ERROR',
        detail: 'oops',
      });
      expect(next.messages).toHaveLength(3);
      expect(next.messages[2].content).toContain('Something went wrong');
    });
  });

  describe('ALL_CONV_TOGGLED', () => {
    it('opens the FocusView', () => {
      const next = threadReducer(initialState, {
        type: 'ALL_CONV_TOGGLED',
        open: true,
      });
      expect(next.allConvOpen).toBe(true);
    });

    it('on close, clears search and pendingDelete (clean slate next open)', () => {
      const seed: ThreadState = {
        ...initialState,
        allConvOpen: true,
        searchQuery: 'mrr',
        pendingDelete: sampleThread(),
      };
      const next = threadReducer(seed, {
        type: 'ALL_CONV_TOGGLED',
        open: false,
      });
      expect(next.allConvOpen).toBe(false);
      expect(next.searchQuery).toBe('');
      expect(next.pendingDelete).toBeNull();
    });

    it('on open, preserves search and pendingDelete', () => {
      const seed: ThreadState = {
        ...initialState,
        searchQuery: 'previously typed',
        pendingDelete: sampleThread(),
      };
      const next = threadReducer(seed, {
        type: 'ALL_CONV_TOGGLED',
        open: true,
      });
      expect(next.searchQuery).toBe('previously typed');
      expect(next.pendingDelete).not.toBeNull();
    });
  });

  describe('SEARCH_UPDATED', () => {
    it('sets query', () => {
      const next = threadReducer(initialState, {
        type: 'SEARCH_UPDATED',
        query: 'mrr',
      });
      expect(next.searchQuery).toBe('mrr');
    });

    it('overwrites prior query', () => {
      const seed: ThreadState = { ...initialState, searchQuery: 'old' };
      const next = threadReducer(seed, {
        type: 'SEARCH_UPDATED',
        query: 'new',
      });
      expect(next.searchQuery).toBe('new');
    });
  });

  describe('PENDING_DELETE_SET / CLEARED', () => {
    it('SET sets pendingDelete', () => {
      const t = sampleThread();
      const next = threadReducer(initialState, {
        type: 'PENDING_DELETE_SET',
        thread: t,
      });
      expect(next.pendingDelete).toEqual(t);
    });

    it('CLEARED sets pendingDelete to null', () => {
      const seed: ThreadState = {
        ...initialState,
        pendingDelete: sampleThread(),
      };
      const next = threadReducer(seed, { type: 'PENDING_DELETE_CLEARED' });
      expect(next.pendingDelete).toBeNull();
    });
  });

  describe('THREAD_DELETED', () => {
    it('removes thread from threads list', () => {
      const seed: ThreadState = {
        ...initialState,
        threads: [
          sampleThread({ thread_id: 'thr_a' }),
          sampleThread({ thread_id: 'thr_b' }),
        ],
      };
      const next = threadReducer(seed, {
        type: 'THREAD_DELETED',
        threadId: 'thr_a',
      });
      expect(next.threads).toHaveLength(1);
      expect(next.threads[0].thread_id).toBe('thr_b');
    });

    it('clears active thread + messages when deleting active thread', () => {
      const seed: ThreadState = {
        ...initialState,
        activeThreadId: 'thr_a',
        messages: [{ role: 'user', content: 'q' }],
        threads: [sampleThread({ thread_id: 'thr_a' })],
      };
      const next = threadReducer(seed, {
        type: 'THREAD_DELETED',
        threadId: 'thr_a',
      });
      expect(next.activeThreadId).toBeNull();
      expect(next.messages).toEqual([]);
    });

    it('preserves active thread when deleting a different thread', () => {
      const seed: ThreadState = {
        ...initialState,
        activeThreadId: 'thr_a',
        messages: [{ role: 'user', content: 'q' }],
        threads: [
          sampleThread({ thread_id: 'thr_a' }),
          sampleThread({ thread_id: 'thr_b' }),
        ],
      };
      const next = threadReducer(seed, {
        type: 'THREAD_DELETED',
        threadId: 'thr_b',
      });
      expect(next.activeThreadId).toBe('thr_a');
      expect(next.messages).toHaveLength(1);
    });

    it('clears pendingDelete', () => {
      const seed: ThreadState = {
        ...initialState,
        threads: [sampleThread({ thread_id: 'thr_a' })],
        pendingDelete: sampleThread({ thread_id: 'thr_a' }),
      };
      const next = threadReducer(seed, {
        type: 'THREAD_DELETED',
        threadId: 'thr_a',
      });
      expect(next.pendingDelete).toBeNull();
    });
  });
});
