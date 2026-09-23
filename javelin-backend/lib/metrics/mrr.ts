// mrr — sum of monthly-normalized values for active + past_due subs, per currency.
// Spec: Build plan/metric-definitions.md L226–L247.
//
// Derived from subscription_enriched: same exclusion rules, no re-implementation.

import {
  subscriptionEnriched,
  type StripeSubscriptionLike,
} from './subscriptionEnriched';

export interface MrrRow {
  currency: string;
  mrr: number;
  subscription_count: number;
}

export interface MrrResult {
  kind: 'rows';
  rows: MrrRow[];
  /** Phase 2D Q6 Layer 2 — lexical guard against state/flow confusion. mrr
   *  is a STATE metric (current run-rate snapshot). The companion
   *  mrr_movement tool returns FLOW metrics (changes over a period). Never
   *  combine them numerically (see CRITICAL RULE #8). */
  metric_type: 'state';
  definition: 'stripe_billing_analytics_glossary.mrr';
  as_of: number;
}

export interface MrrInput {
  subscriptions: StripeSubscriptionLike[];
  now: Date;
}

export function mrr(input: MrrInput): MrrResult {
  const enriched = subscriptionEnriched(input);

  const buckets = new Map<string, { mrr: number; subscription_count: number }>();
  for (const row of enriched.rows) {
    if (!row.contributes_to_mrr) continue;
    const bucket = buckets.get(row.currency) ?? { mrr: 0, subscription_count: 0 };
    bucket.mrr += row.monthly_normalized_amount;
    bucket.subscription_count += 1;
    buckets.set(row.currency, bucket);
  }

  const rows = Array.from(buckets.entries())
    .map(([currency, b]) => ({ currency, mrr: b.mrr, subscription_count: b.subscription_count }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    kind: 'rows',
    rows,
    metric_type: 'state',
    definition: 'stripe_billing_analytics_glossary.mrr',
    as_of: enriched.as_of,
  };
}
