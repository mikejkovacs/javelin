// churn_reasons — counts the customer-stated reasons (cancellation_details.feedback)
// for subscription cancellations in a date period.
//
// Spec: Build plan/metric-definitions.md (companion to churn_count, locked
// 2026-04-29 as part of Step 3 / Option C — separate tool from churn_count).
//
// Source field: `cancellation_details.feedback` — the customer-submitted
// reason. Populated only when the customer cancels via Stripe's hosted
// Customer Portal cancellation flow. Many merchants on custom flows have
// all-null feedback; the metric must read well in that case.
//
// Reason taxonomy (from Stripe API ref): customer_service, low_quality,
// missing_features, other, switched_service, too_complex, too_expensive,
// unused. Plus null when unset. Unrecognized future values bucket as `other`
// defensively.
//
// Sources:
//   - https://docs.stripe.com/api/subscriptions/object (cancellation_details.feedback)

import type { StripeSubscriptionLike } from './subscriptionEnriched';
import type { Period } from './types';

const KNOWN_FEEDBACK = new Set([
  'customer_service',
  'low_quality',
  'missing_features',
  'other',
  'switched_service',
  'too_complex',
  'too_expensive',
  'unused',
]);

const HIGH_COVERAGE_THRESHOLD = 0.5;

export type CoverageLevel = 'high' | 'partial' | 'none';

export interface ChurnReasonsBuckets {
  too_expensive: number;
  missing_features: number;
  switched_service: number;
  unused: number;
  customer_service: number;
  low_quality: number;
  too_complex: number;
  other: number;
  none: number;
}

export interface ChurnReasonsValue {
  total: number;
  feedback_provided: number;
  buckets: ChurnReasonsBuckets;
}

export interface ChurnReasonsResult {
  kind: 'scalar';
  value: ChurnReasonsValue;
  unit: 'count';
  definition: 'javelin_defined.churn_reasons';
  coverage: CoverageLevel;
  period: Period;
  as_of: number;
}

export interface ChurnReasonsInput {
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

function bucketFeedback(
  feedback: string | null | undefined,
): keyof ChurnReasonsBuckets {
  if (feedback == null) return 'none';
  if (!KNOWN_FEEDBACK.has(feedback)) return 'other';
  return feedback as keyof ChurnReasonsBuckets;
}

function classifyCoverage(value: ChurnReasonsValue): CoverageLevel {
  if (value.total === 0) return 'none';
  if (value.feedback_provided === 0) return 'none';
  return value.feedback_provided / value.total >= HIGH_COVERAGE_THRESHOLD
    ? 'high'
    : 'partial';
}

export function churnReasons(input: ChurnReasonsInput): ChurnReasonsResult {
  const { subscriptions, period, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  const buckets: ChurnReasonsBuckets = {
    too_expensive: 0,
    missing_features: 0,
    switched_service: 0,
    unused: 0,
    customer_service: 0,
    low_quality: 0,
    too_complex: 0,
    other: 0,
    none: 0,
  };

  let total = 0;
  let feedback_provided = 0;

  for (const sub of subscriptions) {
    if (!endedInPeriod(sub, period)) continue;
    total += 1;
    const feedback = sub.cancellation_details?.feedback;
    if (feedback != null) feedback_provided += 1;
    buckets[bucketFeedback(feedback)] += 1;
  }

  const value: ChurnReasonsValue = { total, feedback_provided, buckets };

  return {
    kind: 'scalar',
    value,
    unit: 'count',
    definition: 'javelin_defined.churn_reasons',
    coverage: classifyCoverage(value),
    period,
    as_of: nowSec,
  };
}
