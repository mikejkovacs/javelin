import {
  Box,
  Button,
  ContextView,
  Icon,
  Inline,
  Spinner,
  TextField,
} from '@stripe/ui-extension-sdk/ui';
import type { ExtensionContextValue } from '@stripe/ui-extension-sdk/context';
import {
  createHttpClient,
  STRIPE_API_KEY,
} from '@stripe/ui-extension-sdk/http_client';
import Stripe from 'stripe';
import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { createSignedFetch } from '../utils/signedFetch';
import {
  getActiveSubscriptions,
  getBilledInvoices,
  getCanceledSubscriptions,
  getProducts,
  getCustomers,
  getCharges,
  getConnectedAccounts,
  getOldestCharge,
} from '../utils/stripeData';
import {
  buildProfileFromStripe,
  createSecretStoreProfileStore,
  isStale,
  type Profile,
  type StripeMode,
} from '../../../javelin-backend/lib/profile';
import { parseAskStream } from '../utils/askStream';
import { pickShimmer, labelForTool } from '../utils/shimmerPhrases';
import { makeApi, ASK_ENDPOINT } from '../utils/api';
import { newThreadId, newMessageId } from '../utils/ids';
import {
  threadReducer,
  initialState,
  type Message,
  type ThreadSummary,
} from '../state/threadReducer';
import { EmptyState } from './EmptyState';
import { ConversationView } from './ConversationView';
import { ThreadMenu } from './ThreadMenu';
import { AllConversationsView } from './AllConversationsView';

const App = ({ userContext, environment }: ExtensionContextValue) => {
  const signedFetch = useMemo(
    () => createSignedFetch(userContext),
    [userContext],
  );
  const api = useMemo(() => makeApi(signedFetch), [signedFetch]);
  const [state, dispatch] = useReducer(threadReducer, initialState);
  const [input, setInput] = useState('');
  const [businessName, setBusinessName] = useState<string | null>(null);
  const profileRef = useRef<Profile | null>(null);
  const buildInFlightRef = useRef(false);

  // ── Mount: load thread list (Decision 1: eager-on-first-mount) ────────────
  useEffect(() => {
    api
      .listThreads()
      .then((threads) => dispatch({ type: 'THREADS_LOADED', threads }))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[Javelin] threads list load failed:', err);
      });
  }, [api]);

  // ── Mount: fetch business name for greeting (Decision D-name = Option B) ──
  // Falls back to no-name greeting on null/empty/unexpected.
  useEffect(() => {
    const stripe = new Stripe(STRIPE_API_KEY, {
      httpClient: createHttpClient() as Stripe.HttpClient,
      apiVersion: '2026-01-28.clover',
    });

    stripe.accounts
      .retrieve()
      .then((account) => {
        const name = account.business_profile?.name;
        if (typeof name === 'string' && name.trim().length > 0) {
          setBusinessName(name.trim());
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(
          '[Javelin] business name fetch failed; greeting falls back to no name:',
          err,
        );
      });
  }, []);

  // ── Mount: profile loader (unchanged from prior App.tsx) ──────────────────
  useEffect(() => {
    const stripe = new Stripe(STRIPE_API_KEY, {
      httpClient: createHttpClient() as Stripe.HttpClient,
      apiVersion: '2026-01-28.clover',
    });
    const store = createSecretStoreProfileStore(stripe);
    const mode: StripeMode = environment?.mode === 'test' ? 'test' : 'live';

    (async () => {
      try {
        const existing = await store.read(mode);
        if (existing) {
          profileRef.current = existing;
          // eslint-disable-next-line no-console
          console.log(
            '[Javelin] profile: loaded from cache\n',
            JSON.stringify(existing, null, 2),
          );
        }

        if (isStale(existing) && !buildInFlightRef.current) {
          buildInFlightRef.current = true;
          // eslint-disable-next-line no-console
          console.log(
            '[Javelin] profile: stale or missing, rebuilding in background',
          );
          try {
            const fresh = await buildProfileFromStripe<Stripe>({
              stripe,
              mode,
              fetchers: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                getActiveSubscriptions: getActiveSubscriptions as any,
                getCustomers,
                getProducts,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                getCharges: getCharges as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                getBilledInvoices: getBilledInvoices as any,
                getConnectedAccounts,
                getOldestCharge,
                getCanceledSubscriptions,
              },
              previousProfile: profileRef.current,
            });
            await store.write(fresh);
            profileRef.current = fresh;
            // eslint-disable-next-line no-console
            console.log(
              '[Javelin] profile: rebuild complete\n',
              JSON.stringify(fresh, null, 2),
            );
          } finally {
            buildInFlightRef.current = false;
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          '[Javelin] profile: setup failed, continuing without grounding:',
          err,
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewThread = useCallback(() => {
    dispatch({ type: 'THREAD_RESET' });
  }, []);

  const switchToThread = useCallback(
    async (threadId: string) => {
      try {
        const { thread, messages } = await api.getThread(threadId);
        dispatch({
          type: 'THREAD_SELECTED',
          threadId: thread.thread_id,
          messages,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[Javelin] thread switch failed:', err);
      }
    },
    [api],
  );

  const handleMenuAction = useCallback(
    async (key: string) => {
      if (key === '__empty__') return;
      if (key === '__all_conv__') {
        dispatch({ type: 'ALL_CONV_TOGGLED', open: true });
        return;
      }
      await switchToThread(key);
    },
    [switchToThread],
  );

  const handleDeleteConfirm = useCallback(
    async (thread: ThreadSummary) => {
      try {
        await api.deleteThread(thread.thread_id);
        dispatch({ type: 'THREAD_DELETED', threadId: thread.thread_id });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[Javelin] thread delete failed:', err);
        dispatch({ type: 'PENDING_DELETE_CLEARED' });
      }
    },
    [api],
  );

  const handleSubmit = useCallback(async () => {
    const question = input.trim();
    if (!question || state.stage !== 'idle') return;

    setInput('');
    const threadId = state.activeThreadId ?? newThreadId();
    const messageId = newMessageId();
    const userMsg: Message = { role: 'user', content: question };

    dispatch({ type: 'MESSAGE_SUBMITTED', userMsg, threadId });

    let shimmerIndex: number | undefined;
    const refreshShimmer = () => {
      const next = pickShimmer(shimmerIndex);
      shimmerIndex = next.index;
      dispatch({ type: 'SHIMMER_SET', shimmer: next.phrase });
    };
    refreshShimmer();

    const toolsUsed: string[] = [];
    // Tracks whether the next text-delta follows a tool-output boundary,
    // so we can insert a paragraph break instead of letting pre-tool and
    // post-tool text concatenate (e.g. "...let me pull that.A note...").
    // Reset to false on the first delta after each boundary.
    let needsParagraphBreak = false;

    try {
      // eslint-disable-next-line no-console
      console.log('[Javelin] POST to /api/ask (threaded)');
      const res = await signedFetch(ASK_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({
          thread_id: threadId,
          message_id: messageId,
          content: question,
          profile: profileRef.current,
        }),
      });

      if (res.status === 409) {
        // eslint-disable-next-line no-console
        console.warn(
          '[Javelin] /api/ask returned 409 — re-hydrating thread from server',
        );
        const hydrated = await api.getThread(threadId);
        dispatch({
          type: 'THREAD_SELECTED',
          threadId,
          messages: hydrated.messages,
        });
        return;
      }

      if (!res.ok) throw new Error(`Backend error: ${res.status}`);

      await parseAskStream(res, (event) => {
        switch (event.type) {
          case 'tool-input-start':
            toolsUsed.push(event.toolName);
            dispatch({
              type: 'CHIP_SET',
              chip: labelForTool(event.toolName),
            });
            refreshShimmer();
            break;
          case 'tool-output-available':
            dispatch({ type: 'CHIP_SET', chip: null });
            refreshShimmer();
            needsParagraphBreak = true;
            break;
          case 'tool-output-error':
          case 'tool-output-denied':
            dispatch({ type: 'CHIP_SET', chip: null });
            refreshShimmer();
            needsParagraphBreak = true;
            break;
          case 'text-delta': {
            const delta = needsParagraphBreak
              ? '\n\n' + event.delta
              : event.delta;
            needsParagraphBreak = false;
            dispatch({ type: 'TEXT_DELTA', delta });
            break;
          }
          case 'error':
            // eslint-disable-next-line no-console
            console.error(
              '[Javelin] /api/ask stream error:',
              event.errorText,
            );
            break;
        }
      });

      if (toolsUsed.length > 0) {
        dispatch({ type: 'TOOLS_USED', tools: toolsUsed });
      }
      dispatch({ type: 'STREAM_FINISHED' });

      setTimeout(async () => {
        try {
          const threads = await api.listThreads();
          dispatch({ type: 'THREADS_LOADED', threads });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[Javelin] thread list refresh failed:', err);
        }
      }, 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Javelin] handleSubmit failed:', err);
      const detail =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      dispatch({ type: 'STREAM_ERROR', detail });
    }
  }, [input, state.stage, state.activeThreadId, signedFetch, api]);

  const activeThread = state.threads.find(
    (t) => t.thread_id === state.activeThreadId,
  );
  const drawerTitle = activeThread?.title ?? 'New conversation';
  const isLoading = state.stage !== 'idle';
  const isStreaming = state.stage === 'streaming';

  return (
    <ContextView
      title={drawerTitle}
      actions={
        // Box with explicit stack='x' + gapX. Earlier Pass 1 attempt used
        // <Inline css={{ gapX: 'small' }}> without explicit stack='x' —
        // gapX wasn't applied because Inline (like Box) requires explicit
        // stack='x' for gap to take effect. Same pattern as footerContent
        // input row.
        <Box css={{ stack: 'x', gapX: 'small', alignY: 'center' }}>
          <Button type="secondary" onPress={handleNewThread}>
            <Icon name="edit" />
          </Button>
          <ThreadMenu
            threads={state.threads}
            onSelect={handleMenuAction}
          />
        </Box>
      }
      footerContent={
        // Pass 2: input anchored at drawer footer (always at bottom).
        // Conversation grows from top of body; latest message stays
        // visible near the input as content overflows. Outer paddingY
        // adds breathing room so the input no longer feels cramped
        // against the drawer's footer edge.
        <Box
          css={{
            stack: 'x',
            gapX: 'small',
            alignY: 'center',
            paddingY: 'small',
          }}
        >
          <Box css={{ width: 'fill' }}>
            <TextField
              label="Ask a question"
              hiddenElements={['label']}
              placeholder={
                businessName
                  ? `Ask about ${businessName}`
                  : 'Ask about your business'
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
            />
          </Box>
          <Button
            type="primary"
            onPress={handleSubmit}
            disabled={isLoading}
          >
            <Icon name="arrowUp" />
          </Button>
        </Box>
      }
    >
      <Box css={{ stack: 'y', gapY: 'medium' }}>
        {state.messages.length === 0 ? (
          <EmptyState businessName={businessName} />
        ) : (
          <ConversationView
            messages={state.messages}
            isStreaming={isStreaming}
          />
        )}
        {isLoading &&
          (state.currentChip !== null || state.currentShimmer !== null) && (
            // Latency-mask indicator: Spinner stays anchored while the
            // adjacent text swaps between the active tool chip and a
            // shimmer phrase. Both states render with the same caption-
            // secondary typography so the swap doesn't read as different
            // UI primitives flickering in/out. Subdued background gives
            // the row a "system indicator" feel distinct from body text.
            <Box
              css={{
                stack: 'x',
                gapX: 'small',
                alignY: 'center',
                padding: 'small',
                backgroundColor: 'surface',
                borderRadius: 'medium',
              }}
            >
              <Spinner />
              <Box css={{ font: 'caption', color: 'secondary' }}>
                {state.currentChip !== null
                  ? state.currentChip
                  : state.currentShimmer}
              </Box>
            </Box>
          )}

        <AllConversationsView
          open={state.allConvOpen}
          threads={state.threads}
          searchQuery={state.searchQuery}
          pendingDelete={state.pendingDelete}
          onClose={() => dispatch({ type: 'ALL_CONV_TOGGLED', open: false })}
          onSearchChange={(query) =>
            dispatch({ type: 'SEARCH_UPDATED', query })
          }
          onSelectThread={switchToThread}
          onDeleteRequest={(thread) =>
            dispatch({ type: 'PENDING_DELETE_SET', thread })
          }
          onDeleteConfirm={handleDeleteConfirm}
          onDeleteCancel={() =>
            dispatch({ type: 'PENDING_DELETE_CLEARED' })
          }
        />
      </Box>
    </ContextView>
  );
};

export default App;
