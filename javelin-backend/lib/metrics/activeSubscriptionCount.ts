// active_subscription_count — count of subscriptions where contributes_to_mrr = true.
// Spec: Build plan/metric-definitions.md L253–L257.
//
// Subscription-level count (not subscriber-level — see active_subscription_customer_count
// in def doc, which is a separate metric not yet implemented).

import {
  subscriptionEnriched,
  type StripeSubscriptionLike,
} from './subscriptionEnriched';

export interface ActiveSubscriptionCountResult {
  kind: 'scalar';
  value: number;
  unit: 'count';
  definition: 'javelin.active_subscription_count.v1';
  as_of: number;
}

export interface ActiveSubscriptionCountInput {
  subscriptions: StripeSubscriptionLike[];
  now: Date;
}

export function activeSubscriptionCount(
  input: ActiveSubscriptionCountInput
): ActiveSubscriptionCountResult {
  const enriched = subscriptionEnriched(input);
  const value = enriched.rows.filter((r) => r.contributes_to_mrr).length;
  return {
    kind: 'scalar',
    value,
    unit: 'count',
    definition: 'javelin.active_subscription_count.v1',
    as_of: enriched.as_of,
  };
}
