// Bucket helpers for time-series primitives.
//
// Given a Period + Granularity, generate the ordered list of bucket keys,
// and given a unix timestamp, compute the bucket key it falls into.
//
// Conventions (locked Phase 2C design lock 2026-05-09):
//   - day:   calendar day in UTC, key 'YYYY-MM-DD'
//   - week:  ISO-8601 Monday-start week, key 'YYYY-MM-DD' of the Monday
//   - month: calendar month in UTC, key 'YYYY-MM'
//
// Dense series semantics: bucketKeysForPeriod returns EVERY bucket from the
// one containing period.start through the one containing period.end, even
// if no charges fall in some of them. Primitives use this to zero-fill
// gaps before emitting series rows.
//
// Bucket-count caps (MAX_BUCKETS): per-granularity ceilings enforced at the
// tool-wrapper layer to bound LLM payload size. Day caps at 90 (~1 quarter),
// week at 52 (~1 year), month at 36 (~3 years). Tool wrappers throw a typed
// error when a request would exceed these; the LLM is taught (via few-shot)
// to fall back to a coarser granularity.

import type { Period } from './types';

export type Granularity = 'day' | 'week' | 'month';

export const MAX_BUCKETS: Record<Granularity, number> = {
  day: 90,
  week: 52,
  month: 36,
};

export function bucketKey(unixSec: number, granularity: Granularity): string {
  const d = new Date(unixSec * 1000);
  switch (granularity) {
    case 'day':
      return formatYMD(d);
    case 'week':
      return formatYMD(mondayStartOf(d));
    case 'month':
      return formatYM(d);
  }
}

export function bucketKeysForPeriod(
  period: Period,
  granularity: Granularity,
): string[] {
  const keys: string[] = [];
  let cursor = bucketStartDate(period.start, granularity);
  const endCursor = bucketStartDate(period.end, granularity);

  // Safety bound — month over 250 years = 3000. Caps enforce smaller in
  // practice but this keeps a runaway loop from happening on bad input.
  for (let i = 0; i < 3001; i++) {
    keys.push(formatBucketKey(cursor, granularity));
    if (cursor.getTime() >= endCursor.getTime()) break;
    cursor = advanceBucket(cursor, granularity);
  }
  return keys;
}

export function bucketCount(period: Period, granularity: Granularity): number {
  return bucketKeysForPeriod(period, granularity).length;
}

// ── internal helpers ─────────────────────────────────────────────────────────

function formatYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatYM(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// JS getUTCDay: Sunday=0, Monday=1, ..., Saturday=6. ISO weeks start Monday.
function mondayStartOf(d: Date): Date {
  const dow = d.getUTCDay();
  const daysToMonday = dow === 0 ? 6 : dow - 1;
  const m = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  m.setUTCDate(m.getUTCDate() - daysToMonday);
  return m;
}

function bucketStartDate(unixSec: number, granularity: Granularity): Date {
  const d = new Date(unixSec * 1000);
  switch (granularity) {
    case 'day':
      return new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
      );
    case 'week':
      return mondayStartOf(d);
    case 'month':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }
}

function formatBucketKey(d: Date, granularity: Granularity): string {
  return granularity === 'month' ? formatYM(d) : formatYMD(d);
}

function advanceBucket(d: Date, granularity: Granularity): Date {
  const next = new Date(d.getTime());
  switch (granularity) {
    case 'day':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'week':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'month':
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }
  return next;
}
