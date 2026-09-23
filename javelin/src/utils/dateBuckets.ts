import type { ThreadSummary } from '../state/threadReducer';

export type Bucket = 'today' | 'yesterday' | 'last_7_days' | 'older';

export interface BucketedThreads {
  today: ThreadSummary[];
  yesterday: ThreadSummary[];
  last_7_days: ThreadSummary[];
  older: ThreadSummary[];
}

/**
 * Bucket a thread by its `last_active_at` against day boundaries (local time).
 *
 *   today      — last_active_at >= start of today
 *   yesterday  — last_active_at >= start of yesterday (and not today)
 *   last_7_days — last_active_at >= start of 6 days ago (and not today/yesterday)
 *                  → "Last 7 days" inclusive of today + 6 prior days
 *   older      — anything earlier
 *
 * Used in `AllConversationsView` to render Claude.ai-style date bucketing.
 */
export function bucketize(
  thread: ThreadSummary,
  now: Date = new Date(),
): Bucket {
  const lastActive = new Date(thread.last_active_at);

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const startOf7DaysAgo = new Date(startOfToday);
  startOf7DaysAgo.setDate(startOf7DaysAgo.getDate() - 6);

  if (lastActive >= startOfToday) return 'today';
  if (lastActive >= startOfYesterday) return 'yesterday';
  if (lastActive >= startOf7DaysAgo) return 'last_7_days';
  return 'older';
}

/** Group threads by bucket, preserving input order within each bucket. */
export function bucketizeThreads(
  threads: ThreadSummary[],
  now: Date = new Date(),
): BucketedThreads {
  const result: BucketedThreads = {
    today: [],
    yesterday: [],
    last_7_days: [],
    older: [],
  };
  for (const t of threads) {
    result[bucketize(t, now)].push(t);
  }
  return result;
}
