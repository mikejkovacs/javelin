// churn_rate — Stripe-canonical rolling 30-day subscriber churn rate.
//
// Spec: Build plan/metric-definitions.md L361–L373.
//
// Definition tag: `stripe_billing_analytics_glossary.subscriber_churn_rate`.
// Stripe's verbatim definition (Billing analytics glossary): "The number of
// total churned subscribers in the past 30 days, divided by the number of
// active subscribers 30 days ago, plus the total new subscribers in the past
// 30 days."
//
//   churn_rate = churned_30d / (active_30d_ago + new_30d)
//
// Subscriber-level (distinct customer_ids), NOT subscription-level. The
// rolling-30 window is fixed per Stripe's definition — this metric does NOT
// accept a date-range input.
//
// Boundary semantics (consistent with churn_count):
//   - churned_30d: subs with `ended_at >= T-30d AND <= now` (inclusive both edges)
//   - active_30d_ago: subs whose lifetime spans T-30d
//       i.e. start_date <= T-30d AND (still active OR ended_at > T-30d)
//     Strict > on end means a sub that ended at exactly T-30d is NOT
//     counted as active at T-30d (it was over by then).
//   - new_30d: subs with start_date >= T-30d (regardless of current status)
//
// If denominator is 0 (insufficient subscriber history), value returns null
// but the component counts are still populated so the LLM can narrate the
// underlying numbers ("you have 1 churn but no historical baseline yet").
//
// Sources:
//   - https://docs.stripe.com/billing/subscriptions/analytics/glossary

import type { StripeSubscriptionLike } from './subscriptionEnriched';

const ROLLING_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

export interface ChurnRateComponents {
  churned_30d: number;
  active_30d_ago: number;
  new_30d: number;
}

export interface ChurnRateResult {
  kind: 'scalar';
  value: number | null;                            // 0..1 ratio; null if denominator is 0
  unit: 'percent';
  definition: 'stripe_billing_analytics_glossary.subscriber_churn_rate';
  components: ChurnRateComponents;
  window: { start: number; end: number };          // [T-30d, now]
  as_of: number;
}

export interface ChurnRateInput {
  // Currently-active + past_due subs.
  active_subscriptions: StripeSubscriptionLike[];
  // Canceled subs scoped to the rolling-30-day window. Caller (the tool
  // wrapper) passes the filtered set; the primitive defensively re-filters by
  // `ended_at` so it remains correct under wider inputs.
  canceled_subscriptions: StripeSubscriptionLike[];
  now: Date;
}

// ── Phase 2F (LTV) — windowed variant ────────────────────────────────────────
//
// Stripe's canonical churn rate is the 30-day rolling window above. For the
// LTV tool, merchants with low subscriber counts often have zero churn in a
// 30-day window — the formula then goes silent. To enable an opt-in wider
// window for LTV computation (90-day or 365-day), this generalized helper
// re-runs the same component logic over a parametrized window.
//
// Definition tag flips based on window:
//   - window_days === 30 → stripe_billing_analytics_glossary.subscriber_churn_rate
//   - window_days !== 30 → javelin_defined.subscriber_churn_rate_extended
//
// The canonical `churnRate()` above is the public Stripe-canonical interface;
// `subscriberChurnRateForWindow()` is the LTV-internal generalization. Both
// share the same observation logic.

export type SubscriberChurnRateWindowDays = 30 | 90 | 365;

export interface SubscriberChurnRateForWindowComponents {
  churned: number;
  active_window_start: number;
  new_in_window: number;
}

export interface SubscriberChurnRateForWindowResult {
  kind: 'scalar';
  value: number | null;
  unit: 'percent';
  /** Canonical tag for 30-day window; deviation tag for wider windows. */
  definition:
    | 'stripe_billing_analytics_glossary.subscriber_churn_rate'
    | 'javelin_defined.subscriber_churn_rate_extended';
  components: SubscriberChurnRateForWindowComponents;
  window_days: SubscriberChurnRateWindowDays;
  window: { start: number; end: number };
  as_of: number;
}

function customerId(c: StripeSubscriptionLike['customer']): string {
  return typeof c === 'string' ? c : c.id;
}

export function subscriberChurnRateForWindow(
  input: ChurnRateInput,
  window_days: SubscriberChurnRateWindowDays,
): SubscriberChurnRateForWindowResult {
  const { active_subscriptions, canceled_subscriptions, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);
  const t_minus_window = nowSec - window_days * SECONDS_PER_DAY;

  // churned in window: distinct customers with a sub ended in [T-window, now].
  const churnedCustomers = new Set<string>();
  for (const sub of canceled_subscriptions) {
    if (sub.ended_at == null) continue;
    if (sub.ended_at < t_minus_window) continue;
    if (sub.ended_at > nowSec) continue;
    churnedCustomers.add(customerId(sub.customer));
  }

  // active at window start: distinct customers with a sub spanning T-window.
  const activeWindowStart = new Set<string>();
  for (const sub of active_subscriptions) {
    if (sub.start_date <= t_minus_window) {
      activeWindowStart.add(customerId(sub.customer));
    }
  }
  for (const sub of canceled_subscriptions) {
    if (
      sub.start_date <= t_minus_window &&
      sub.ended_at != null &&
      sub.ended_at > t_minus_window
    ) {
      activeWindowStart.add(customerId(sub.customer));
    }
  }

  // new in window: distinct customers with a sub starting in [T-window, now].
  const newCustomers = new Set<string>();
  for (const sub of active_subscriptions) {
    if (sub.start_date > t_minus_window) newCustomers.add(customerId(sub.customer));
  }
  for (const sub of canceled_subscriptions) {
    if (sub.start_date > t_minus_window) newCustomers.add(customerId(sub.customer));
  }

  const components: SubscriberChurnRateForWindowComponents = {
    churned: churnedCustomers.size,
    active_window_start: activeWindowStart.size,
    new_in_window: newCustomers.size,
  };

  const denominator = components.active_window_start + components.new_in_window;
  const value = denominator === 0 ? null : components.churned / denominator;

  return {
    kind: 'scalar',
    value,
    unit: 'percent',
    definition:
      window_days === 30
        ? 'stripe_billing_analytics_glossary.subscriber_churn_rate'
        : 'javelin_defined.subscriber_churn_rate_extended',
    components,
    window_days,
    window: { start: t_minus_window, end: nowSec },
    as_of: nowSec,
  };
}

export function churnRate(input: ChurnRateInput): ChurnRateResult {
  // Canonical Stripe-glossary churn rate is the 30-day windowed variant with
  // legacy field names preserved on the result envelope (churned_30d etc.).
  const w = subscriberChurnRateForWindow(input, ROLLING_DAYS);
  return {
    kind: 'scalar',
    value: w.value,
    unit: 'percent',
    definition: 'stripe_billing_analytics_glossary.subscriber_churn_rate',
    components: {
      churned_30d: w.components.churned,
      active_30d_ago: w.components.active_window_start,
      new_30d: w.components.new_in_window,
    },
    window: w.window,
    as_of: w.as_of,
  };
}
