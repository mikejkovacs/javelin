// ltv — Subscriber Lifetime Value (Phase 2F).
//
// Stripe-canonical formula: LTV = ARPU / Subscriber Churn Rate.
// Verbatim from Stripe Billing analytics glossary:
//   "Subscriber lifetime value is calculated by dividing the average revenue
//    per user (ARPU) by the subscriber churn rate."
//   https://docs.stripe.com/billing/subscriptions/analytics/glossary
//
// ── Window decision (Q2 = 2A-strict-with-window-option, locked 2026-05-13) ───
// Default: Stripe-canonical 30-day rolling churn rate (matches Stripe Dashboard).
// Optional: merchant may widen to 90-day or 365-day for stability at low N.
// When window != 30d, envelope flags `deviates_from_stripe_canonical: true`
// so the LLM surfaces the deviation in narration.
//
// Rationale: Stripe Billing's own LTV chart uses the canonical 30-day churn
// rate, which goes silent (returns null) when small-N merchants observe zero
// churn in 30d — exactly the dominant case for ICP merchants like Merchant A.
// The wider-window override lets the merchant extract a usable estimate from
// older churn signal while making the trade-off transparent.
//
// ── Output shape (Q5 = 5A scope-flag carry-forward from Phase 2E) ────────────
// `scope: 'subscription_mrr'` envelope flag mirrors growth_attribution's
// Path Z pattern — signals that LTV operates on subscription billing only,
// NOT one-off charges or non-subscription invoices.
//
// ── V1 limitations ───────────────────────────────────────────────────────────
// 1. Subscription-billing scope only — does NOT include one-off charge revenue
//    per customer. Scope flag in envelope.
// 2. Extrapolation assumption — formula computes lifetime revenue per
//    subscriber by extrapolating the observed window's churn rate forward
//    indefinitely. If real future churn rate differs from the window
//    observation (likely — churn rarely stays constant), actual lifetime
//    revenue per subscriber will diverge from this estimate. Inherent to the
//    formula; Stripe Dashboard makes the same assumption.
// 3. Wider windows (90d, 365d) diverge from Stripe Dashboard. Envelope flag
//    `deviates_from_stripe_canonical: true`; LLM must surface the deviation.
// 4. Single global churn rate across currencies — for multi-currency merchants,
//    the same churn rate denominator applies to per-currency ARPU rows.
//    Matches Stripe's published methodology (churn is subscriber-counted
//    globally, not per-currency).
// 5. Inherits ARPU's low-sample fragility — small subscriber-base denominators
//    produce noisy LTV; the `low_sample` flag is forwarded but the noise
//    doesn't vanish. At very low N, single churn events produce huge LTV swings.

import { arpu } from './arpu';
import {
  subscriberChurnRateForWindow,
  type SubscriberChurnRateWindowDays,
} from './churnRate';
import type { StripeSubscriptionLike } from './subscriptionEnriched';

export type LtvChurnWindow = '30d' | '90d' | '365d';
export type LtvCoverage = 'computed' | 'no_subscribers' | 'no_churn_observed';

export interface LtvRow {
  currency: string;
  /** LTV in major units; null when not computable. */
  value: number | null;
  /** The ARPU input used (major units). */
  arpu: number;
  /** The churn rate input used (0..1 ratio); null when no churn observed. */
  churn_rate: number | null;
  /** 1/churn_rate in months; null when churn_rate is null. */
  implied_lifetime_months: number | null;
  /** Forwarded from arpu(recurring); true when active subscriber count < 10. */
  low_sample: boolean;
  /** Explicit reason when value is null. */
  coverage: LtvCoverage;
}

export interface LtvResult {
  kind: 'rows';
  rows: LtvRow[];                          // per-currency
  scope: 'subscription_mrr';               // Path Z carry-forward from 2E
  window_used: LtvChurnWindow;             // echoed-back param
  deviates_from_stripe_canonical: boolean; // true when window_used != '30d'
  definition: 'javelin_defined.ltv';
  as_of: number;
}

export interface LtvInput {
  // arpu(recurring) input
  subscriptions: StripeSubscriptionLike[];           // active + past_due
  // subscriberChurnRateForWindow input
  active_subscriptions: StripeSubscriptionLike[];
  canceled_subscriptions: StripeSubscriptionLike[];
  // LTV-specific
  churn_window?: LtvChurnWindow;                     // default '30d'
  now: Date;
}

function windowToDays(w: LtvChurnWindow): SubscriberChurnRateWindowDays {
  switch (w) {
    case '30d':
      return 30;
    case '90d':
      return 90;
    case '365d':
      return 365;
  }
}

export function ltv(input: LtvInput): LtvResult {
  const nowSec = Math.floor(input.now.getTime() / 1000);
  const window_used: LtvChurnWindow = input.churn_window ?? '30d';
  const window_days = windowToDays(window_used);

  // Compose: ARPU (per-currency) + churn rate (global) → per-currency LTV
  const arpuResult = arpu({
    basis: 'recurring',
    subscriptions: input.subscriptions,
    now: input.now,
  });
  const churnResult = subscriberChurnRateForWindow(
    {
      active_subscriptions: input.active_subscriptions,
      canceled_subscriptions: input.canceled_subscriptions,
      now: input.now,
    },
    window_days,
  );

  const churn = churnResult.value; // null | 0..1

  const rows: LtvRow[] = arpuResult.rows.map((arpuRow) => {
    // Decide coverage for this row.
    // Note: arpu(recurring) emits a row with arpu=0 and customer_count=0 +
    // currency 'unknown' when there are no subscriptions at all. Detect that
    // via customer_count rather than arpu value (an active-sub merchant can
    // legitimately have an arpu>0 plan).
    if (arpuRow.customer_count === 0) {
      return {
        currency: arpuRow.currency,
        value: null,
        arpu: 0,
        churn_rate: churn,
        implied_lifetime_months: null,
        low_sample: arpuRow.low_sample,
        coverage: 'no_subscribers' as const,
      };
    }
    if (churn === null || churn === 0) {
      return {
        currency: arpuRow.currency,
        value: null,
        arpu: arpuRow.arpu,
        churn_rate: churn,
        implied_lifetime_months: null,
        low_sample: arpuRow.low_sample,
        coverage: 'no_churn_observed' as const,
      };
    }
    return {
      currency: arpuRow.currency,
      value: arpuRow.arpu / churn,
      arpu: arpuRow.arpu,
      churn_rate: churn,
      implied_lifetime_months: 1 / churn,
      low_sample: arpuRow.low_sample,
      coverage: 'computed' as const,
    };
  });

  return {
    kind: 'rows',
    rows,
    scope: 'subscription_mrr',
    window_used,
    deviates_from_stripe_canonical: window_used !== '30d',
    definition: 'javelin_defined.ltv',
    as_of: nowSec,
  };
}
