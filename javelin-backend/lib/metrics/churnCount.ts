// churn_count — count of subscriptions whose MRR contribution ended in the
// period, split by cancellation_details.reason.
//
// Spec: Build plan/metric-definitions.md L337–L359.
//
// Stripe-canonical alignment: This metric's `ended_at` filter is semantically
// aligned with Stripe Sigma's `subscription_item_change_events.event_type =
// 'ACTIVE_END'`. We don't use Sigma directly (D1 deferral); the state-snapshot
// path may drift at edges (mid-period proration, retroactive adjustments).
//
// Reason taxonomy (voluntary/involuntary/other) is Javelin-defined — Stripe
// publishes the four-value enum but no taxonomy on top of it. Unrecognized
// future enum values fall through to `unknown` defensively.
//
// Sources:
//   - https://docs.stripe.com/api/subscriptions/object (cancellation_details.reason)
//   - https://docs.stripe.com/billing/subscriptions/analytics/glossary

import type { StripeSubscriptionLike } from './subscriptionEnriched';
import type { Period } from './types';

const VOLUNTARY_REASONS = new Set([
  'cancellation_requested',
  'canceled_by_retention_policy',
]);
const INVOLUNTARY_REASONS = new Set(['payment_failed']);
const OTHER_REASONS = new Set(['payment_disputed']);

const TOO_FEW_THRESHOLD = 5;
const SINGLE_BUCKET_DOMINANCE = 0.8;

export type BreakdownSignificance = 'meaningful' | 'too_few' | 'single_bucket';

export interface ChurnCountValue {
  total: number;
  voluntary: number;
  involuntary: number;
  other: number;
  unknown: number;
}

export interface ChurnCountResult {
  kind: 'scalar';
  value: ChurnCountValue;
  unit: 'count';
  definition: 'javelin_defined.churn_count';
  breakdown_significance: BreakdownSignificance;
  period: Period;
  as_of: number;
}

export interface ChurnCountInput {
  // Canceled subscriptions; the primitive defensively re-filters by `ended_at`
  // so it remains correct even if a caller passes a wider set.
  subscriptions: StripeSubscriptionLike[];
  period: Period;
  now: Date;
}

function endedInPeriod(
  sub: StripeSubscriptionLike,
  period: Period,
): boolean {
  return (
    sub.ended_at != null &&
    sub.ended_at >= period.start &&
    sub.ended_at <= period.end
  );
}

function bucketReason(
  reason: string | null | undefined,
): 'voluntary' | 'involuntary' | 'other' | 'unknown' {
  if (reason == null) return 'unknown';
  if (VOLUNTARY_REASONS.has(reason)) return 'voluntary';
  if (INVOLUNTARY_REASONS.has(reason)) return 'involuntary';
  if (OTHER_REASONS.has(reason)) return 'other';
  return 'unknown';
}

function classifyBreakdown(value: ChurnCountValue): BreakdownSignificance {
  if (value.total < TOO_FEW_THRESHOLD) return 'too_few';
  const max = Math.max(
    value.voluntary,
    value.involuntary,
    value.other,
    value.unknown,
  );
  if (max / value.total >= SINGLE_BUCKET_DOMINANCE) return 'single_bucket';
  return 'meaningful';
}

export function churnCount(input: ChurnCountInput): ChurnCountResult {
  const { subscriptions, period, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  const value: ChurnCountValue = {
    total: 0,
    voluntary: 0,
    involuntary: 0,
    other: 0,
    unknown: 0,
  };

  for (const sub of subscriptions) {
    if (!endedInPeriod(sub, period)) continue;
    const bucket = bucketReason(sub.cancellation_details?.reason);
    value[bucket] += 1;
    value.total += 1;
  }

  return {
    kind: 'scalar',
    value,
    unit: 'count',
    definition: 'javelin_defined.churn_count',
    breakdown_significance: classifyBreakdown(value),
    period,
    as_of: nowSec,
  };
}
