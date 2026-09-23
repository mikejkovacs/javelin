import {
  Banner,
  Box,
  Button,
  FocusView,
  Icon,
  Link,
  TextField,
} from '@stripe/ui-extension-sdk/ui';
import { useEffect, useState } from 'react';
import type { ThreadSummary } from '../state/threadReducer';
import { bucketizeThreads, type Bucket } from '../utils/dateBuckets';

interface AllConversationsViewProps {
  open: boolean;
  threads: ThreadSummary[];
  searchQuery: string;
  pendingDelete: ThreadSummary | null;
  onClose: () => void;
  onSearchChange: (query: string) => void;
  onSelectThread: (threadId: string) => void;
  onDeleteRequest: (thread: ThreadSummary) => void;
  onDeleteConfirm: (thread: ThreadSummary) => void;
  onDeleteCancel: () => void;
}

const BUCKET_LABELS: Record<Bucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  older: 'Older',
};
const BUCKET_ORDER: Bucket[] = ['today', 'yesterday', 'last_7_days', 'older'];

/**
 * Debounces a value — returned value updates `delayMs` after `value` last
 * changed. Used to throttle the search filter against the iframe-roundtrip
 * cost on every keystroke.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

function filterByQuery(
  threads: ThreadSummary[],
  query: string,
): ThreadSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return threads;
  return threads.filter((t) =>
    (t.title ?? 'New conversation').toLowerCase().includes(q),
  );
}

/**
 * "All conversations" management surface. Opens via the kebab Menu's
 * "All conversations →" entry. Provides:
 *   - Search by title (150ms debounced filter)
 *   - Date-bucketed list (Today / Yesterday / Last 7 days / Older)
 *   - Per-row select (re-hydrates thread, closes FocusView via reducer)
 *   - Per-row trash icon → Banner confirmation → soft-delete via API
 *
 * State lives in App.tsx (reducer); this component is purely presentational
 * + dispatches user intent via the prop callbacks.
 *
 * Pass 1 polish: thread title Links use `type="primary"` because that
 * variant removes the default underline (verified 2026-05-05). Trash
 * button uses SDK-default secondary styling — `size="small"` renders
 * larger, not smaller (SDK quirk). See feedback memory
 * `feedback_javelin_stripe_apps_sdk_layout.md` gotchas #2 and #3.
 */
export function AllConversationsView(props: AllConversationsViewProps) {
  const debouncedQuery = useDebouncedValue(props.searchQuery, 150);
  const filtered = filterByQuery(props.threads, debouncedQuery);
  const buckets = bucketizeThreads(filtered);

  return (
    <FocusView
      title="All conversations"
      shown={props.open}
      setShown={(shown) => {
        if (!shown) props.onClose();
      }}
    >
      <Box css={{ stack: 'y', gapY: 'medium' }}>
        {props.pendingDelete && (
          <Banner
            type="caution"
            title={`Delete "${
              props.pendingDelete.title ?? 'New conversation'
            }"?`}
            actions={
              <Box css={{ stack: 'x', gapX: 'small' }}>
                <Button
                  type="destructive"
                  onPress={() => {
                    if (props.pendingDelete)
                      props.onDeleteConfirm(props.pendingDelete);
                  }}
                >
                  Delete
                </Button>
                <Button type="secondary" onPress={props.onDeleteCancel}>
                  Cancel
                </Button>
              </Box>
            }
          />
        )}

        <TextField
          label="Search"
          placeholder="Search by title…"
          value={props.searchQuery}
          onChange={(e) => props.onSearchChange(e.target.value)}
        />

        {filtered.length === 0 ? (
          <Box
            css={{
              padding: 'medium',
              color: 'secondary',
              font: 'caption',
            }}
          >
            {props.threads.length === 0
              ? 'No conversations yet. Start a new one.'
              : 'No conversations match your search.'}
          </Box>
        ) : (
          <Box css={{ stack: 'y', gapY: 'small' }}>
            {BUCKET_ORDER.map((bucket) => {
              const items = buckets[bucket];
              if (items.length === 0) return null;
              return (
                <Box key={bucket} css={{ stack: 'y', gapY: 'xsmall' }}>
                  <Box
                    css={{
                      font: 'caption',
                      color: 'secondary',
                      fontWeight: 'semibold',
                    }}
                  >
                    {BUCKET_LABELS[bucket]}
                  </Box>
                  {items.map((t) => (
                    <Box
                      key={t.thread_id}
                      css={{
                        stack: 'x',
                        distribute: 'space-between',
                        alignY: 'center',
                        padding: 'xsmall',
                      }}
                    >
                      <Link
                        type="primary"
                        onPress={() => props.onSelectThread(t.thread_id)}
                      >
                        {t.title ?? 'New conversation'}
                      </Link>
                      <Button
                        type="secondary"
                        onPress={() => props.onDeleteRequest(t)}
                      >
                        <Icon name="trash" size="small" />
                      </Button>
                    </Box>
                  ))}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </FocusView>
  );
}
