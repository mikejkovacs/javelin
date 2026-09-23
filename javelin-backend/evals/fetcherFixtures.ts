// Single shared eval fixture — Stripe-shaped object literals consumed by the
// vi.mock'd fetchers. ONE dataset, hand-calibrated, used by all eval cases.
//
// Maintenance rules (per Step 2 plan):
//   - ADDITIVE only. Adding a new resource row is fine; editing an existing
//     row breaks all calibrated case assertions and requires recalibrating
//     in the same commit.
//   - No factories, no DSL — flat object literals. Verbosity is the protection.
//   - Calibrated expected values are documented in the CALIBRATED OUTPUTS block
//     at the bottom; cases hard-code these literals (don't recompute from fixture).
//
// Frozen "today" anchor: 2026-04-29T00:00:00Z (epoch 1777593600).
// All date phrasings ("last month", "Q1 2026", etc.) resolve relative to that.

import type { Stripe } from 'stripe';

// ──────────────────────────────────────────────────────────────────────────────
// Time anchors — frozen. Don't compute these from `new Date()`.
// ──────────────────────────────────────────────────────────────────────────────

export const FROZEN_NOW_ISO = '2026-04-29T00:00:00Z';
export const FROZEN_NOW = new Date(FROZEN_NOW_ISO); // epoch sec: 1777593600

// Useful pre-computed timestamps (seconds since epoch) for fixture rows.
const T = {
  // 2025
  oct_15_2025: Math.floor(new Date('2025-10-15T00:00:00Z').getTime() / 1000),
  // 2026
  jan_15_2026: Math.floor(new Date('2026-01-15T00:00:00Z').getTime() / 1000),
  feb_15_2026: Math.floor(new Date('2026-02-15T00:00:00Z').getTime() / 1000),
  mar_05_2026: Math.floor(new Date('2026-03-05T00:00:00Z').getTime() / 1000),
  mar_15_2026: Math.floor(new Date('2026-03-15T00:00:00Z').getTime() / 1000),
  mar_16_2026: Math.floor(new Date('2026-03-16T00:00:00Z').getTime() / 1000),
  mar_20_2026: Math.floor(new Date('2026-03-20T00:00:00Z').getTime() / 1000),
  mar_22_2026: Math.floor(new Date('2026-03-22T00:00:00Z').getTime() / 1000),
  mar_25_2026: Math.floor(new Date('2026-03-25T00:00:00Z').getTime() / 1000),
  apr_01_2026: Math.floor(new Date('2026-04-01T00:00:00Z').getTime() / 1000),
  apr_10_2026: Math.floor(new Date('2026-04-10T00:00:00Z').getTime() / 1000),
  apr_15_2026: Math.floor(new Date('2026-04-15T00:00:00Z').getTime() / 1000),
  apr_28_2026: Math.floor(new Date('2026-04-28T00:00:00Z').getTime() / 1000),
  apr_29_2026: Math.floor(new Date('2026-04-29T00:00:00Z').getTime() / 1000),
  apr_30_2026: Math.floor(new Date('2026-04-30T00:00:00Z').getTime() / 1000),
  may_01_2026: Math.floor(new Date('2026-05-01T00:00:00Z').getTime() / 1000),
  may_03_2026: Math.floor(new Date('2026-05-03T00:00:00Z').getTime() / 1000),
  may_15_2026: Math.floor(new Date('2026-05-15T00:00:00Z').getTime() / 1000),
  // Subscription start dates
  aug_01_2025: Math.floor(new Date('2025-08-01T00:00:00Z').getTime() / 1000),
  sep_15_2025: Math.floor(new Date('2025-09-15T00:00:00Z').getTime() / 1000),
  dec_01_2025: Math.floor(new Date('2025-12-01T00:00:00Z').getTime() / 1000),
  // Churn-related anchors (Q4 2025 single_bucket scenario)
  oct_20_2025: Math.floor(new Date('2025-10-20T00:00:00Z').getTime() / 1000),
  nov_05_2025: Math.floor(new Date('2025-11-05T00:00:00Z').getTime() / 1000),
  nov_28_2025: Math.floor(new Date('2025-11-28T00:00:00Z').getTime() / 1000),
  dec_10_2025: Math.floor(new Date('2025-12-10T00:00:00Z').getTime() / 1000),
  dec_22_2025: Math.floor(new Date('2025-12-22T00:00:00Z').getTime() / 1000),
  // Churn-related anchors (March 2026 meaningful-breakdown scenario)
  mar_03_2026: Math.floor(new Date('2026-03-03T00:00:00Z').getTime() / 1000),
  mar_08_2026: Math.floor(new Date('2026-03-08T00:00:00Z').getTime() / 1000),
  mar_12_2026: Math.floor(new Date('2026-03-12T00:00:00Z').getTime() / 1000),
  mar_18_2026: Math.floor(new Date('2026-03-18T00:00:00Z').getTime() / 1000),
  mar_24_2026: Math.floor(new Date('2026-03-24T00:00:00Z').getTime() / 1000),
  mar_30_2026: Math.floor(new Date('2026-03-30T00:00:00Z').getTime() / 1000),
  // M2 Phase 2C-pre — failed_payments fixture coverage
  mar_28_2026: Math.floor(new Date('2026-03-28T00:00:00Z').getTime() / 1000),
};

// ──────────────────────────────────────────────────────────────────────────────
// Account default currency — what fetchAccountDefaultCurrency returns.
// ──────────────────────────────────────────────────────────────────────────────

export const FIXTURE_DEFAULT_CURRENCY = 'usd';

// ──────────────────────────────────────────────────────────────────────────────
// Subscriptions — 4 total: 3 active + 1 past_due. All USD, monthly, no discount.
// MRR = $300 + $200 + $500 + $400 = $1,400. Sub count contributing to MRR = 4.
// ──────────────────────────────────────────────────────────────────────────────

export const FIXTURE_SUBSCRIPTIONS = [
  {
    id: 'sub_acme',
    customer: 'cus_acme',
    status: 'active',
    start_date: T.aug_01_2025,
    canceled_at: null,
    ended_at: null,
    cancellation_details: null,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: {
      data: [
        {
          id: 'si_acme',
          quantity: 1,
          price: {
            id: 'price_300',
            nickname: 'Pro Monthly',
            unit_amount: 30000, // $300.00
            currency: 'usd',
            product: { id: 'prod_pro', name: 'Pro' },
            recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
          },
        },
      ],
    },
  },
  {
    id: 'sub_beta',
    customer: 'cus_beta',
    status: 'active',
    start_date: T.sep_15_2025,
    canceled_at: null,
    ended_at: null,
    cancellation_details: null,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    // M2 Phase 2A — cus_beta scheduled to cancel at period end. Powers the
    // upcoming_cancellations heads-up surface in customer_recent_activity.
    // Read only by customerRecentActivity (other primitives don't gate on
    // cancel_at_period_end), so adding these fields is purely additive.
    cancel_at_period_end: true,
    cancel_at: T.may_15_2026,
    items: {
      data: [
        {
          id: 'si_beta',
          quantity: 1,
          price: {
            id: 'price_200',
            nickname: 'Starter Monthly',
            unit_amount: 20000, // $200.00
            currency: 'usd',
            product: { id: 'prod_starter', name: 'Starter' },
            recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
          },
        },
      ],
    },
  },
  {
    id: 'sub_gamma',
    customer: 'cus_gamma',
    status: 'active',
    start_date: T.jan_15_2026,
    canceled_at: null,
    ended_at: null,
    cancellation_details: null,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: {
      data: [
        {
          id: 'si_gamma',
          quantity: 1,
          price: {
            id: 'price_500',
            nickname: 'Enterprise Monthly',
            unit_amount: 50000, // $500.00
            currency: 'usd',
            product: { id: 'prod_enterprise', name: 'Enterprise' },
            recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
          },
        },
      ],
    },
  },
  {
    id: 'sub_delta',
    customer: 'cus_delta',
    status: 'past_due', // contributes to MRR per primitive (active OR past_due)
    start_date: T.dec_01_2025,
    canceled_at: null,
    ended_at: null,
    cancellation_details: null,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: {
      data: [
        {
          id: 'si_delta',
          quantity: 1,
          price: {
            id: 'price_400',
            nickname: 'Pro Monthly',
            unit_amount: 40000, // $400.00
            currency: 'usd',
            product: { id: 'prod_pro', name: 'Pro' },
            recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
          },
        },
      ],
    },
  },
] as unknown as Stripe.Subscription[];

// ──────────────────────────────────────────────────────────────────────────────
// Canceled subscriptions — 11 total. Independent customer IDs (cus_alpha …
// cus_kilo) to keep churn fixture isolated from MRR / concentration calibrations.
//
// March 2026 churns (6, mixed reasons → 'meaningful' breakdown):
//   3 voluntary (2 cancellation_requested + 1 canceled_by_retention_policy)
//     - 1 too_expensive feedback, 1 missing_features, 1 switched_service
//   2 involuntary (payment_failed) — feedback null (no portal flow)
//   1 other (payment_disputed) — feedback null
//   → churn_reasons: total 6, feedback_provided 3 (50%) → coverage 'high'
//     buckets: too_expensive=1, missing_features=1, switched_service=1, none=3
//
// Q4 2025 churns (5, all payment_failed → 'single_bucket' breakdown):
//   5 involuntary (payment_failed) — feedback null (involuntary churn never
//   passes through Customer Portal)
//   → churn_reasons: total 5, feedback_provided 0 → coverage 'none'
//
// April 2026 churns: intentionally empty (0 → 'too_few' breakdown).
// ──────────────────────────────────────────────────────────────────────────────

// Stub item used by every canceled-sub fixture row. churn_count doesn't read
// items; this satisfies StripeSubscriptionLike's structural typing.
const CANCELED_STUB_ITEM = {
  id: 'si_stub',
  quantity: 1,
  price: {
    id: 'price_stub',
    nickname: null,
    unit_amount: 10000,
    currency: 'usd',
    product: { id: 'prod_stub', name: 'Stub' },
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  },
};

export const FIXTURE_CANCELED_SUBSCRIPTIONS = [
  // ── March 2026 (6 subs) ──────────────────────────────────────────────────
  {
    id: 'sub_can_alpha',
    customer: 'cus_alpha',
    status: 'canceled',
    start_date: T.aug_01_2025,
    canceled_at: T.mar_03_2026,
    ended_at: T.mar_03_2026,
    cancellation_details: { reason: 'cancellation_requested', feedback: 'too_expensive' },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
  {
    id: 'sub_can_bravo',
    customer: 'cus_bravo',
    status: 'canceled',
    start_date: T.aug_01_2025,
    canceled_at: T.mar_08_2026,
    ended_at: T.mar_08_2026,
    cancellation_details: { reason: 'cancellation_requested', feedback: 'missing_features' },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
  {
    id: 'sub_can_charlie',
    customer: 'cus_charlie',
    status: 'canceled',
    start_date: T.sep_15_2025,
    canceled_at: T.mar_12_2026,
    ended_at: T.mar_12_2026,
    cancellation_details: { reason: 'canceled_by_retention_policy', feedback: 'switched_service' },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
  {
    id: 'sub_can_delta',
    customer: 'cus_delta_old',
    status: 'canceled',
    start_date: T.sep_15_2025,
    canceled_at: T.mar_18_2026,
    ended_at: T.mar_18_2026,
    cancellation_details: { reason: 'payment_failed', feedback: null },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
  {
    id: 'sub_can_echo',
    customer: 'cus_echo',
    status: 'canceled',
    start_date: T.dec_01_2025,
    canceled_at: T.mar_24_2026,
    ended_at: T.mar_24_2026,
    cancellation_details: { reason: 'payment_failed', feedback: null },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
  {
    id: 'sub_can_foxtrot',
    customer: 'cus_foxtrot',
    status: 'canceled',
    start_date: T.dec_01_2025,
    canceled_at: T.mar_30_2026,
    ended_at: T.mar_30_2026,
    cancellation_details: { reason: 'payment_disputed', feedback: null },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
  // ── Q4 2025 (5 subs, all payment_failed) ─────────────────────────────────
  {
    id: 'sub_can_golf',
    customer: 'cus_golf',
    status: 'canceled',
    start_date: T.aug_01_2025,
    canceled_at: T.oct_20_2025,
    ended_at: T.oct_20_2025,
    cancellation_details: { reason: 'payment_failed', feedback: null },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
  {
    id: 'sub_can_hotel',
    customer: 'cus_hotel',
    status: 'canceled',
    start_date: T.aug_01_2025,
    canceled_at: T.nov_05_2025,
    ended_at: T.nov_05_2025,
    cancellation_details: { reason: 'payment_failed', feedback: null },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
  {
    id: 'sub_can_india',
    customer: 'cus_india',
    status: 'canceled',
    start_date: T.aug_01_2025,
    canceled_at: T.nov_28_2025,
    ended_at: T.nov_28_2025,
    cancellation_details: { reason: 'payment_failed', feedback: null },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
  {
    id: 'sub_can_juliet',
    customer: 'cus_juliet',
    status: 'canceled',
    start_date: T.sep_15_2025,
    canceled_at: T.dec_10_2025,
    ended_at: T.dec_10_2025,
    cancellation_details: { reason: 'payment_failed', feedback: null },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
  {
    id: 'sub_can_kilo',
    customer: 'cus_kilo',
    status: 'canceled',
    start_date: T.sep_15_2025,
    canceled_at: T.dec_22_2025,
    ended_at: T.dec_22_2025,
    cancellation_details: { reason: 'payment_failed', feedback: null },
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: { data: [CANCELED_STUB_ITEM] },
  },
] as unknown as Stripe.Subscription[];

// ──────────────────────────────────────────────────────────────────────────────
// Customers — 5 total. cus_solo has null name + email-only to exercise the
// display_name fallback in customer_concentration.
// ──────────────────────────────────────────────────────────────────────────────

// Two Jennys added 2026-05-01 (Chunk C / 2B) to stress-test the
// customer_lookup disambiguation flow (same first name, different last
// names + emails). Jenny Rosen has more recent activity than Jenny Smith
// → she's the one picked first by the most-recent-activity sort (Q9.1).
// cus_solo's existing null-name + email-only shape already exercises the
// display_name fallback; no separate cus_no_name needed.

export const FIXTURE_CUSTOMERS = [
  { id: 'cus_acme', name: 'Acme Corp', email: 'billing@acme.com', created: T.aug_01_2025, deleted: false },
  { id: 'cus_beta', name: 'Beta Inc', email: 'ap@beta.com', created: T.sep_15_2025, deleted: false },
  { id: 'cus_gamma', name: 'Gamma LLC', email: 'finance@gamma.com', created: T.jan_15_2026, deleted: false },
  { id: 'cus_delta', name: 'Delta Co', email: 'billing@delta.com', created: T.dec_01_2025, deleted: false },
  { id: 'cus_solo', name: null, email: 'solo@example.com', created: T.feb_15_2026, deleted: false },
  { id: 'cus_jenny_rosen', name: 'Jenny Rosen', email: 'jenny@example.com', created: T.aug_01_2025, deleted: false, phone: null },
  { id: 'cus_jenny_smith', name: 'Jenny Smith', email: 'jenny.smith@example.com', created: T.dec_01_2025, deleted: false, phone: null },
  // Description-only-named customer — name/individual_name/business_name
  // all null, identity lives in `description`. Mirrors the Joy Rowe pattern
  // observed during 2B production validation. Exercises both the extended
  // multi-field Stripe Search and the extended display_name fallback chain
  // landed as the Chunk C close hot-fix (2026-05-01).
  {
    id: 'cus_desc_only',
    name: null,
    individual_name: null,
    business_name: null,
    description: 'Joy Rowe',
    email: 'joy.e.rowe@example.com',
    created: T.dec_01_2025,
    deleted: false,
    phone: null,
  },
] as unknown as Stripe.Customer[];

// ──────────────────────────────────────────────────────────────────────────────
// Charges — 7 total, USD. Each succeeded charge paired with a BT below by
// matching IDs (charge.balance_transaction === bt.id).
// ──────────────────────────────────────────────────────────────────────────────

export const FIXTURE_CHARGES = [
  // March 2026 — 4 succeeded + 1 failed
  {
    id: 'ch_1',
    customer: 'cus_acme',
    amount: 100000, // $1,000.00
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    created: T.mar_05_2026,
    disputed: false,
    refunded: false,
    balance_transaction: 'bt_1',
    invoice: 'in_1',
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
  },
  {
    id: 'ch_2',
    customer: 'cus_beta',
    amount: 50000, // $500.00
    amount_refunded: 10000, // $100 refunded
    currency: 'usd',
    status: 'succeeded',
    created: T.mar_15_2026,
    disputed: false,
    refunded: false,
    balance_transaction: 'bt_2',
    // Re-linked to in_2 (2026-04-30) so revenue_by_plan can attribute this
    // charge to 'Starter Monthly'. Doesn't affect period_collected_revenue or
    // any other existing calibration — the link is read only by revenue_by_plan.
    invoice: 'in_2',
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
  },
  {
    id: 'ch_3',
    customer: 'cus_acme',
    amount: 200000, // $2,000.00
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    created: T.mar_20_2026,
    disputed: true, // disputed, lost — see FIXTURE_DISPUTES below
    refunded: false,
    balance_transaction: 'bt_3',
    invoice: null,
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
  },
  {
    id: 'ch_4',
    customer: 'cus_gamma',
    amount: 30000, // $300.00
    amount_refunded: 0,
    currency: 'usd',
    status: 'failed', // excluded by collected-revenue status filter
    created: T.mar_25_2026,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    invoice: null,
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
    billing_details: { email: 'jcleese@example.com', name: 'John Cleese' },
    failure_code: 'card_declined', // M2 Phase 2C-pre — feeds failure_reasons
  },
  // Phase 2C-pre additions — 2 more failed charges for richer test coverage:
  // multi-customer top_failures + multi-bucket failure_reasons. All in March
  // 2026 so they show up in "what were my failed payments in March?" eval.
  // Failed charges are excluded by status filter from all collected-revenue
  // metrics, so these additions are purely additive.
  {
    id: 'ch_failed_2',
    customer: 'cus_beta',
    amount: 20000, // $200.00
    amount_refunded: 0,
    currency: 'usd',
    status: 'failed',
    created: T.mar_18_2026,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    invoice: null,
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
    billing_details: { email: 'beta@industries.com', name: 'Beta Industries' },
    failure_code: 'insufficient_funds',
  },
  {
    id: 'ch_failed_3',
    customer: 'cus_solo',
    amount: 15000, // $150.00
    amount_refunded: 0,
    currency: 'usd',
    status: 'failed',
    created: T.mar_28_2026,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    invoice: null,
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
    billing_details: { email: 'solo@example.com', name: 'Solo Founder' },
    failure_code: 'insufficient_funds',
  },
  {
    id: 'ch_7',
    customer: 'cus_solo',
    amount: 30000, // $300.00 (cleaner number; was $250 in plan)
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    created: T.mar_22_2026,
    disputed: false,
    refunded: false,
    balance_transaction: 'bt_7',
    invoice: null,
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
  },
  // April 2026 — 1 identified + 1 guest checkout
  {
    id: 'ch_5',
    customer: 'cus_acme',
    amount: 80000, // $800.00
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    created: T.apr_10_2026,
    disputed: false,
    refunded: false,
    balance_transaction: 'bt_5',
    invoice: 'in_3',
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
  },
  {
    // Guest-checkout charge — exercises paying_customer_count's `guest_payments`
    // sidecar narration at the LLM-eval layer. Added 2026-04-30; small enough
    // ($50) to bump period_collected_revenue_april calibration $800 → $850.
    id: 'ch_guest',
    customer: null,
    amount: 5000, // $50.00
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    created: T.apr_10_2026,
    disputed: false,
    refunded: false,
    balance_transaction: 'bt_guest',
    invoice: null,
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
  },
  // Q4 2025 — 1 succeeded
  {
    id: 'ch_6',
    customer: 'cus_gamma',
    amount: 150000, // $1,500.00
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    created: T.oct_15_2025,
    disputed: false,
    refunded: false,
    balance_transaction: 'bt_6',
    invoice: null,
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
  },
  // February 2026 — 2 succeeded multi-currency charges for revenue_by_country
  // eval. Placed in February (currently empty period) to avoid contaminating
  // existing March/April calibrations on currency-grouping primitives like
  // periodCollectedRevenue. Q1 composite case absorbs the extra rows.
  {
    id: 'ch_ca_feb',
    customer: null,
    amount: 30000, // CA$300.00
    amount_refunded: 0,
    currency: 'cad',
    status: 'succeeded',
    created: T.feb_15_2026,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    invoice: null,
    payment_method_details: { card: { country: 'CA', brand: 'visa' } },
  },
  {
    id: 'ch_gb_feb',
    customer: null,
    amount: 12000, // £120.00
    amount_refunded: 0,
    currency: 'gbp',
    status: 'succeeded',
    created: T.feb_15_2026,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    invoice: null,
    payment_method_details: { card: { country: 'GB', brand: 'mastercard' } },
  },
  // Jenny charges added 2026-05-01 (Chunk C / 2B). Recent activity drives
  // disambiguation sort (Jenny Rosen → most-recently-active wins).
  // ch_jr_1 lands inside April → recalibrates period_collected_revenue_april,
  // paying_customer_count_april, customer_concentration_trailing_12mo,
  // compare_periods_collected_march_april.
  // Phase 2C-post (2026-05-09): re-linked invoice from null → 'in_advice' to
  // exercise the product-name fallback path in revenue_by_plan. Now
  // attributes to 'Advice Access' (via productById['prod_advice_access']).
  {
    id: 'ch_jr_1',
    customer: 'cus_jenny_rosen',
    amount: 24500, // $245.00
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    created: T.apr_28_2026,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    invoice: 'in_advice',
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
  },
  {
    id: 'ch_js_1',
    customer: 'cus_jenny_smith',
    amount: 10000, // $100.00 — older activity (Feb 2026)
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    created: T.feb_15_2026,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    invoice: null,
    payment_method_details: { card: { country: 'US', brand: 'visa' } },
  },
] as unknown as Stripe.Charge[];

// ──────────────────────────────────────────────────────────────────────────────
// Balance transactions — paired to charges by id. Refund BT (bt_2r) sits
// alongside the original charge BT for ch_2 (the partially refunded one).
// Fees are 3% flat for clean math; net = amount − fee (in minor units).
//
// Fields added 2026-05-01 (Chunk B / 1D extension, additive — existing
// readers like period_net_cash, comparePeriods don't reference these):
//   - status: 'available' on every existing row (all settled)
//   - reporting_category: matches `type` for our existing rows
//   - amount: gross (= net + fee). Distinct from `net` — used by
//     balance_explanation for "charges" gross-amount-per-category line.
//
// Two new rows added 2026-05-01 to give balance_explanation driver coverage
// (charge, refund, fee, payout). Dispute-driver coverage intentionally
// deferred — adding a `type: 'adjustment'` BT here would silently change
// `period_net_cash_march`'s calibration (it includes 'adjustment' in
// ALLOWED_BT_TYPES). Comes back when a beta merchant has disputes.
//   - bt_payout_apr — single $2,500 payout in April
//   - bt_stripe_fee — standalone $2 Stripe fee BT (e.g. monthly subscription
//     fee), distinct from per-charge processing fees inlined on charge BTs
// ──────────────────────────────────────────────────────────────────────────────

export const FIXTURE_BALANCE_TRANSACTIONS = [
  // March
  { id: 'bt_1', type: 'charge', amount: 100000, fee: 3000, net: 97000, currency: 'usd', created: T.mar_05_2026, status: 'available', reporting_category: 'charge' }, // ch_1 gross $1,000 net $970
  { id: 'bt_2', type: 'charge', amount: 50000, fee: 1500, net: 48500, currency: 'usd', created: T.mar_15_2026, status: 'available', reporting_category: 'charge' }, // ch_2 gross $500 net $485
  { id: 'bt_2r', type: 'refund', amount: -10000, fee: 0, net: -10000, currency: 'usd', created: T.mar_16_2026, status: 'available', reporting_category: 'refund' }, // refund of $100
  { id: 'bt_3', type: 'charge', amount: 200000, fee: 6000, net: 194000, currency: 'usd', created: T.mar_20_2026, status: 'available', reporting_category: 'charge' }, // ch_3 gross $2,000 net $1,940
  { id: 'bt_7', type: 'charge', amount: 30000, fee: 900, net: 29100, currency: 'usd', created: T.mar_22_2026, status: 'available', reporting_category: 'charge' }, // ch_7 gross $300 net $291
  // April
  { id: 'bt_stripe_fee', type: 'stripe_fee', amount: -200, fee: 0, net: -200, currency: 'usd', created: T.apr_01_2026, status: 'available', reporting_category: 'fee' }, // standalone $2 Stripe fee
  { id: 'bt_5', type: 'charge', amount: 80000, fee: 2400, net: 77600, currency: 'usd', created: T.apr_10_2026, status: 'available', reporting_category: 'charge' }, // ch_5 gross $800 net $776
  { id: 'bt_guest', type: 'charge', amount: 5000, fee: 150, net: 4850, currency: 'usd', created: T.apr_10_2026, status: 'available', reporting_category: 'charge' }, // ch_guest gross $50 net $48.50
  { id: 'bt_payout_apr', type: 'payout', amount: -250000, fee: 0, net: -250000, currency: 'usd', created: T.apr_15_2026, status: 'available', reporting_category: 'payout' }, // $2,500 payout to bank
  // October 2025
  { id: 'bt_6', type: 'charge', amount: 150000, fee: 4500, net: 145500, currency: 'usd', created: T.oct_15_2025, status: 'available', reporting_category: 'charge' }, // ch_6 gross $1,500 net $1,455
] as unknown as Stripe.BalanceTransaction[];

// ──────────────────────────────────────────────────────────────────────────────
// Balance snapshot (Stripe /v1/balance) for account_balance tool.
// USD-only Modern-Cents-shaped: $3,500 available + $1,200 pending. No
// instant_available; no Connect/Issuing surfaces (Q1.2 — out of ICP scope).
// ──────────────────────────────────────────────────────────────────────────────

export const FIXTURE_BALANCE = {
  object: 'balance',
  available: [{ amount: 350000, currency: 'usd' }],
  pending: [{ amount: 120000, currency: 'usd' }],
  instant_available: null,
  livemode: false,
} as unknown as Stripe.Balance;

// ──────────────────────────────────────────────────────────────────────────────
// Pending balance transactions (status='pending') for account_balance's
// pending_settlement_breakdown. Three pending charges from the last 2 days
// settling on three different dates. Sums to $1,213.50 net — close to but
// not equal to FIXTURE_BALANCE.pending ($1,200) since real Stripe would have
// some round-off variance. Eval assertions don't require exact equality.
// ──────────────────────────────────────────────────────────────────────────────

export const FIXTURE_PENDING_BALANCE_TRANSACTIONS = [
  { id: 'bt_p1', type: 'charge', status: 'pending', amount: 50000, fee: 1500, net: 48500, currency: 'usd', created: T.apr_28_2026, available_on: T.apr_30_2026, reporting_category: 'charge' },
  { id: 'bt_p2', type: 'charge', status: 'pending', amount: 40000, fee: 1200, net: 38800, currency: 'usd', created: T.apr_28_2026, available_on: T.may_01_2026, reporting_category: 'charge' },
  { id: 'bt_p3', type: 'charge', status: 'pending', amount: 35000, fee: 1050, net: 33950, currency: 'usd', created: T.apr_29_2026, available_on: T.may_03_2026, reporting_category: 'charge' },
] as unknown as Stripe.BalanceTransaction[];

// ──────────────────────────────────────────────────────────────────────────────
// Invoices — 5 total. paid/open/uncollectible count toward billed revenue;
// void doesn't. Different finalized_at to exercise period filtering.
// ──────────────────────────────────────────────────────────────────────────────

export const FIXTURE_INVOICES = [
  // March 2026 — paid + open + uncollectible (all count) + void (excluded)
  {
    id: 'in_1',
    customer: 'cus_acme',
    status: 'paid',
    total: 110000,
    subtotal: 100000,
    total_excluding_tax: 100000, // post-discount, pre-tax — primitive uses this for `subtotal` row
    tax: 10000,
    amount_paid: 110000,
    amount_due: 0,
    amount_remaining: 0,
    currency: 'usd',
    created: T.mar_05_2026,
    status_transitions: { finalized_at: T.mar_05_2026, paid_at: T.mar_05_2026, voided_at: null, marked_uncollectible_at: null },
    lines: { data: [{ amount: 100000, price: { id: 'price_300', product: 'prod_pro', nickname: 'Pro Monthly' } }] },
  },
  {
    id: 'in_2',
    customer: 'cus_beta',
    status: 'open',
    total: 55000,
    subtotal: 50000,
    total_excluding_tax: 50000,
    tax: 5000,
    amount_paid: 0,
    amount_due: 55000,
    amount_remaining: 55000,
    currency: 'usd',
    created: T.mar_15_2026,
    // M2 Phase 2C-pre — 2 failed payment attempts on this open invoice.
    // Counts toward failed_payments.failed_invoice_attempts. Additive
    // (period_billed_revenue doesn't read attempt_count).
    attempt_count: 2,
    status_transitions: { finalized_at: T.mar_15_2026, paid_at: null, voided_at: null, marked_uncollectible_at: null },
    lines: { data: [{ amount: 50000, price: { id: 'price_200', product: 'prod_starter', nickname: 'Starter Monthly' } }] },
  },
  {
    id: 'in_4',
    customer: 'cus_acme',
    status: 'void',
    total: 82500,
    subtotal: 75000,
    total_excluding_tax: 75000,
    tax: 7500,
    amount_paid: 0,
    amount_due: 0,
    amount_remaining: 0,
    currency: 'usd',
    created: T.mar_22_2026,
    status_transitions: { finalized_at: T.mar_22_2026, paid_at: null, voided_at: T.mar_22_2026, marked_uncollectible_at: null },
    lines: { data: [{ amount: 75000, price: { id: 'price_300', product: 'prod_pro', nickname: 'Pro Monthly' } }] },
  },
  {
    id: 'in_5',
    customer: 'cus_solo',
    status: 'uncollectible',
    total: 27500,
    subtotal: 25000,
    total_excluding_tax: 25000,
    tax: 2500,
    amount_paid: 0,
    amount_due: 27500,
    amount_remaining: 27500,
    currency: 'usd',
    created: T.mar_22_2026,
    // M2 Phase 2C-pre — 3 failed attempts before merchant marked uncollectible.
    attempt_count: 3,
    status_transitions: { finalized_at: T.mar_22_2026, paid_at: null, voided_at: null, marked_uncollectible_at: T.mar_22_2026 },
    lines: { data: [{ amount: 25000, price: { id: 'price_200', product: 'prod_starter', nickname: 'Starter Monthly' } }] },
  },
  // April 2026 — paid
  {
    id: 'in_3',
    customer: 'cus_gamma',
    status: 'paid',
    total: 220000,
    subtotal: 200000,
    total_excluding_tax: 200000,
    tax: 20000,
    amount_paid: 220000,
    amount_due: 0,
    amount_remaining: 0,
    currency: 'usd',
    created: T.apr_10_2026,
    status_transitions: { finalized_at: T.apr_10_2026, paid_at: T.apr_10_2026, voided_at: null, marked_uncollectible_at: null },
    lines: { data: [{ amount: 200000, price: { id: 'price_500', product: 'prod_enterprise', nickname: 'Enterprise Monthly' } }] },
  },
  // Phase 2C-post — exercises the product-name fallback path in
  // revenue_by_plan. nickname is null and product arrives as a string ID
  // (mirrors the Stripe expand-depth-cap reality on production data).
  // Linked from ch_jr_1 — that charge previously had `invoice: null` and
  // attributed as 'unattributed'; now it attributes to 'Advice Access' via
  // FIXTURE_PRODUCTS. Recalibration impacts:
  //   - revenue_by_plan April: ch_jr_1 moves from 'unattributed' → 'Advice Access'
  //   - period_billed_revenue April: +$245 (now $2,245 across 2 invoices)
  //   - customer_recent_activity jenny_rosen 90d: +1 invoice event (now 2 total)
  // Existing eval assertions updated where regex/range previously locked
  // an exact figure that this addition shifts.
  {
    id: 'in_advice',
    customer: 'cus_jenny_rosen',
    status: 'paid',
    total: 24500,
    subtotal: 24500,
    total_excluding_tax: 24500,
    tax: null,
    amount_paid: 24500,
    amount_due: 0,
    amount_remaining: 0,
    currency: 'usd',
    created: T.apr_28_2026,
    status_transitions: { finalized_at: T.apr_28_2026, paid_at: T.apr_28_2026, voided_at: null, marked_uncollectible_at: null },
    lines: { data: [{ amount: 24500, price: { id: 'price_advice', product: 'prod_advice_access', nickname: null } }] },
  },
] as unknown as Stripe.Invoice[];

// ──────────────────────────────────────────────────────────────────────────────
// Products — Phase 2C-post — separate-fetch-and-join workaround for
// revenue_by_plan attribution when price.nickname is unset and the Stripe
// expand-depth cap blocks price.product expansion.
//
// All existing FIXTURE_INVOICES carry price.nickname, so the production
// fallback path (productById lookup) doesn't fire on any existing eval case.
// FIXTURE_PRODUCTS exists so the primitive's productById map is non-empty
// in the integration path; the fallback resolution itself is exercised by
// surgical unit tests in revenueByPlan.test.ts.
// ──────────────────────────────────────────────────────────────────────────────

export const FIXTURE_PRODUCTS = [
  { id: 'prod_pro', name: 'Pro', active: true },
  { id: 'prod_starter', name: 'Starter', active: true },
  { id: 'prod_enterprise', name: 'Enterprise', active: true },
  // Phase 2C-post — production-pattern product (Merchant A Advice Access).
  // Linked from in_advice; that invoice has nickname:null + product:'prod_advice_access'
  // so revenue_by_plan resolves attribution via the productById fallback path.
  { id: 'prod_advice_access', name: 'Advice Access', active: true },
] as unknown as Stripe.Product[];

// ──────────────────────────────────────────────────────────────────────────────
// Disputes — 1 lost in March (counts toward chargebacks), 1 won in February
// (does NOT count, exercises the status filter).
// ──────────────────────────────────────────────────────────────────────────────

export const FIXTURE_DISPUTES = [
  { id: 'dp_1', amount: 20000, currency: 'usd', status: 'lost', created: T.mar_25_2026 }, // $200 lost in March
  { id: 'dp_2', amount: 15000, currency: 'usd', status: 'won', created: T.feb_15_2026 }, // $150 won — excluded
] as unknown as Stripe.Dispute[];

// ──────────────────────────────────────────────────────────────────────────────
// Subscription update events (M2 Phase 2A) — feeds subscription_item_change
// events into customer_recent_activity. ONE event in April 2026: cus_acme
// upgraded from Starter (price_200) to Pro (price_300). Stripe Events API
// retains ~30 days; this event is at apr_15 (still inside the 30-day window
// from FROZEN_NOW = apr_29).
// ──────────────────────────────────────────────────────────────────────────────

import type { SubscriptionUpdateEvent } from '../lib/metrics/customerRecentActivity';

export const FIXTURE_SUBSCRIPTION_UPDATE_EVENTS: SubscriptionUpdateEvent[] = [
  {
    id: 'evt_acme_upgrade',
    created: T.apr_15_2026,
    subscription: {
      id: 'sub_acme',
      items: {
        data: [
          {
            price: {
              id: 'price_300',
              nickname: 'Pro Monthly',
              product: { name: 'Pro' },
            },
          },
        ],
      },
    },
    previous_attributes: {
      items: {
        data: [{ price: { id: 'price_200' } }],
      },
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// CALIBRATED OUTPUTS — what each tool returns against this fixture for common
// date phrasings. Eval cases hard-code these literals; do not recompute from
// fixture data in case definitions.
//
// Frozen "today": 2026-04-29.
// "last month" → March 2026 (2026-03-01 to 2026-03-31)
// "this month" → April 1 to today (2026-04-01 to 2026-04-29)
// "Q1 2026"   → 2026-01-01 to 2026-03-31 (matches March in this fixture, no Jan/Feb data)
// "Q4 2025"   → 2025-10-01 to 2025-12-31
// "trailing 12 months" → 2025-04-29 to 2026-04-29
// ──────────────────────────────────────────────────────────────────────────────

export const CALIBRATED = {
  mrr: {
    // 4 subs × monthly contributions: $300 + $200 + $500 + $400
    rows: [{ currency: 'usd', mrr: 1400, subscription_count: 4 }],
  },
  active_subscription_count: {
    value: 4, // same set as MRR (active + past_due, contributes_to_mrr = true)
  },
  period_collected_revenue_march: {
    // ch_1 ($1,000) + ch_2 ($500-$100=$400) + ch_3 ($2,000) + ch_7 ($300) = $3,700
    rows: [{ currency: 'usd', collected_revenue: 3700, charge_count: 4 }],
  },
  period_collected_revenue_april: {
    // ch_5 ($800) + ch_guest ($50, guest checkout, no customer) +
    // ch_jr_1 ($245, cus_jenny_rosen, apr_28) = $1,095, 3 charges
    // (Recalibrated 2026-05-01 / Chunk C — Jenny Rosen charge added.)
    rows: [{ currency: 'usd', collected_revenue: 1095, charge_count: 3 }],
  },
  period_collected_revenue_q4_2025: {
    // ch_6 ($1,500)
    rows: [{ currency: 'usd', collected_revenue: 1500, charge_count: 1 }],
  },
  period_billed_revenue_march: {
    // in_1 ($1,000 paid) + in_2 ($500 open) + in_5 ($250 uncollectible) = $1,750
    // in_4 ($750) is void → excluded
    rows: [{ currency: 'usd', billed_revenue: 1750, invoice_count: 3 }],
  },
  period_billed_revenue_april: {
    // in_3 ($2,000 paid) + in_advice ($245 paid, Phase 2C-post) = $2,245
    rows: [{ currency: 'usd', billed_revenue: 2245, invoice_count: 2 }],
  },
  period_net_cash_march: {
    // bt_1 $970 + bt_2 $485 + bt_2r −$100 + bt_3 $1,940 + bt_7 $291 = $3,586
    rows: [{ currency: 'usd', net_cash: 3586, transaction_count: 5 }],
  },
  period_net_revenue_march: {
    // gross collected $3,800 (sum amount, not amount-refunded)
    //   ch_1 $1,000 + ch_2 $500 + ch_3 $2,000 + ch_7 $300 = $3,800
    // refunds $100 (ch_2 amount_refunded)
    // chargebacks $200 (dp_1 lost in March; dp_2 won doesn't count)
    // net_revenue = 3,800 − 100 − 200 = $3,500
    rows: [
      {
        currency: 'usd',
        net_revenue: 3500,
        gross_collected: 3800,
        refunds: 100,
        chargebacks: 200,
      },
    ],
  },
  customer_concentration_march: {
    // March collected revenue by customer (net of refunds, USD only):
    //   cus_acme: $1,000 + $2,000 = $3,000
    //   cus_beta: $400 (after refund)
    //   cus_solo: $300
    //   total_collected: $3,700
    //   top_1 (Acme): $3,000 / $3,700 = 0.8108…
    top_1_customer_name: 'Acme Corp',
    top_1_amount: 3000,
    top_1_share: 0.8108108108108109, // exact ratio
    total_collected: 3700,
  },
  churn_count_march: {
    // 6 subs ended in March: 3 voluntary + 2 involuntary + 1 other + 0 unknown
    total: 6,
    voluntary: 3,
    involuntary: 2,
    other: 1,
    unknown: 0,
    breakdown_significance: 'meaningful' as const,
  },
  churn_count_april: {
    // 0 subs ended in April (intentionally empty)
    total: 0,
    voluntary: 0,
    involuntary: 0,
    other: 0,
    unknown: 0,
    breakdown_significance: 'too_few' as const,
  },
  churn_count_q4_2025: {
    // 5 subs ended in Oct-Dec, all payment_failed
    total: 5,
    voluntary: 0,
    involuntary: 5,
    other: 0,
    unknown: 0,
    breakdown_significance: 'single_bucket' as const,
  },
  churn_reasons_march: {
    // 6 March churns; 3 voluntary subs left feedback (too_expensive,
    // missing_features, switched_service); 3 involuntary/disputed have null
    // feedback. 3 of 6 = 50% → coverage 'high' (>=50% threshold inclusive).
    total: 6,
    feedback_provided: 3,
    too_expensive: 1,
    missing_features: 1,
    switched_service: 1,
    none: 3,
    coverage: 'high' as const,
  },
  churn_reasons_q4_2025: {
    // 5 Q4 churns, all payment_failed → feedback all null → coverage 'none'
    total: 5,
    feedback_provided: 0,
    none: 5,
    coverage: 'none' as const,
  },
  paying_customer_count_march: {
    // ch_1 (cus_acme), ch_2 (cus_beta), ch_3 (cus_acme dup), ch_7 (cus_solo)
    // → 3 distinct customers, 0 guest, total 3
    value: 3,
    with_customer_record: 3,
    guest_payments: 0,
    charge_count: 4,
  },
  paying_customer_count_april: {
    // ch_5 (cus_acme), ch_guest (null), ch_jr_1 (cus_jenny_rosen) →
    // 2 identified + 1 guest = 3 distinct, charge_count 3.
    // (Recalibrated 2026-05-01 / Chunk C.)
    value: 3,
    with_customer_record: 2,
    guest_payments: 1,
    charge_count: 3,
  },
  paying_customer_count_q4_2025: {
    // ch_6 (cus_gamma) → 1 distinct, 0 guest, total 1
    value: 1,
    with_customer_record: 1,
    guest_payments: 0,
    charge_count: 1,
  },
  revenue_by_plan_march: {
    // March charges in USD with invoice → plan attribution:
    //   ch_1 ($1,000) → in_1 → 'Pro Monthly'
    //   ch_2 ($400 net of $100 refund) → in_2 → 'Starter Monthly'
    //   ch_3 ($2,000) → invoice null → 'unattributed'
    //   ch_7 ($300) → invoice null → 'unattributed'
    // Total: $3,700; rows sorted desc by amount.
    rows: [
      { plan_name: 'unattributed', amount: 2300, charge_count: 2 }, // ch_3 + ch_7
      { plan_name: 'Pro Monthly', amount: 1000, charge_count: 1 },
      { plan_name: 'Starter Monthly', amount: 400, charge_count: 1 },
    ],
    total: 3700,
    currency: 'usd',
  },
  churn_rate: {
    // Frozen NOW = 2026-04-29; T-30d = 2026-03-30 00:00:00 UTC.
    // churned_30d: canceled subs with ended_at in [T-30d, now]:
    //   sub_can_foxtrot ended exactly at 2026-03-30 (T-30d) → INCLUDED (>=)
    //   → cus_foxtrot, churned_30d = 1
    // active_30d_ago: customers with a sub active at T-30d:
    //   4 currently-active+past_due subs all started before T-30d → 4 distinct
    //   sub_can_foxtrot ended AT T-30d (strict >, not >=) → NOT included
    //   → active_30d_ago = 4
    // new_30d: customers with sub started after T-30d (strict >):
    //   No fixture sub starts after 2026-03-30 → 0
    // value = 1 / (4 + 0) = 0.25 = 25%
    value: 0.25,
    churned_30d: 1,
    active_30d_ago: 4,
    new_30d: 0,
  },
  compare_periods_collected_march_april: {
    // metric: period_collected_revenue, a=March 2026, b=April 2026
    //   a.value = $3,700, b.value = $1,095 (post Jenny-Rosen recalibration)
    //   delta_absolute = -2,605, delta_percent ≈ -0.7041, direction = down
    // (Recalibrated 2026-05-01 / Chunk C.)
    a_value: 3700,
    b_value: 1095,
    delta_absolute: -2605,
    delta_percent_approx: -0.7040540540,
    direction: 'down' as const,
  },
  compare_periods_churn_q4_to_march: {
    // metric: churn_count, a=Q4 2025, b=March 2026
    //   a.value = 5, b.value = 6
    //   delta_absolute = +1, delta_percent = 0.2, direction = up
    a_value: 5,
    b_value: 6,
    delta_absolute: 1,
    delta_percent: 0.2,
    direction: 'up' as const,
  },
  // Phase 2C-post-v2 — billed-side plan attribution. Sums line.amount per
  // (plan, currency) tuple across all counted invoices (paid + open +
  // uncollectible). Void + draft excluded. Reconciles to
  // period_billed_revenue_march = $1,750.
  revenue_by_plan_billed_march: {
    // in_1 ($1,000 paid)     → Pro Monthly
    // in_2 ($500 open)       → Starter Monthly
    // in_4 ($750 void)       → excluded
    // in_5 ($250 uncollectible) → Starter Monthly
    rows: [
      { plan_name: 'Pro Monthly', currency: 'usd', amount: 1000, invoice_count: 1 },
      { plan_name: 'Starter Monthly', currency: 'usd', amount: 750, invoice_count: 2 },
    ],
    totals_by_currency: { usd: 1750 },
  },
  revenue_by_plan_billed_april: {
    // in_3 ($2,000 paid)      → Enterprise Monthly (nickname path)
    // in_advice ($245 paid)   → Advice Access (productById fallback path)
    rows: [
      { plan_name: 'Enterprise Monthly', currency: 'usd', amount: 2000, invoice_count: 1 },
      { plan_name: 'Advice Access', currency: 'usd', amount: 245, invoice_count: 1 },
    ],
    totals_by_currency: { usd: 2245 },
  },
  revenue_by_plan_april: {
    // ch_5 ($800) → in_3 → 'Enterprise Monthly' (via nickname path)
    // ch_jr_1 ($245) → in_advice → 'Advice Access' (Phase 2C-post — via
    //   productById fallback path; nickname is null on price_advice)
    // ch_guest ($50) → invoice null → 'unattributed'
    rows: [
      { plan_name: 'Enterprise Monthly', amount: 800, charge_count: 1 },
      { plan_name: 'Advice Access', amount: 245, charge_count: 1 },
      { plan_name: 'unattributed', amount: 50, charge_count: 1 },
    ],
    total: 1095,
    currency: 'usd',
  },
  revenue_by_country_february: {
    // February 2026 charges (only multi-currency rows in this period):
    //   ch_ca_feb: CA$300 CAD (CA/cad)
    //   ch_gb_feb: £120 GBP (GB/gbp)
    // Sort: CAD has higher minor-unit total (30000) > GBP (12000)
    rows: [
      { country: 'CA', currency: 'cad', amount: 300, charge_count: 1, share: 1.0 },
      { country: 'GB', currency: 'gbp', amount: 120, charge_count: 1, share: 1.0 },
    ],
    totals_by_currency: { cad: 300, gbp: 120 },
  },
  account_balance: {
    // FIXTURE_BALANCE: $3,500 available + $1,200 pending, USD only.
    // FIXTURE_PENDING_BALANCE_TRANSACTIONS: 3 charges settling apr-30, may-01, may-03.
    available_usd: 3500,
    pending_usd: 1200,
    instant_available: null,
    pending_settlement_breakdown: [
      { available_on: '2026-04-30', currency: 'usd', amount: 485, count: 1 },
      { available_on: '2026-05-01', currency: 'usd', amount: 388, count: 1 },
      { available_on: '2026-05-03', currency: 'usd', amount: 339.5, count: 1 },
    ],
  },
  balance_explanation_trailing_30d: {
    // Window: trailing 30 days from FROZEN_NOW 2026-04-29 → 2026-03-30 to 2026-04-29.
    // In-window BTs:
    //   bt_stripe_fee (apr_01): standalone fee, amount -$2
    //   bt_5 (apr_10): charge, amount $800, fee $24
    //   bt_guest (apr_10): charge, amount $50, fee $1.50
    //   bt_payout_apr (apr_15): payout, amount -$2,500
    //   (bt_dispute_mar at mar_26 is OUTSIDE the window)
    //
    // Synthesized fee row merges standalone $-2 + per-charge $-25.50 = -$27.50 (count 3).
    // current_balance = 3500 + 1200 = $4,700 (from FIXTURE_BALANCE)
    // net_activity = $850 charge + (-$27.50) fee = $822.50
    // payouts.total = $2,500 (1 count)
    // starting = current − net_activity + payouts.total = 4700 - 822.50 + 2500 = $6,377.50
    // ending = starting + net_activity − payouts.total = 6377.50 + 822.50 - 2500 = $4,700 ✓
    starting_balance_usd: 6377.5,
    charge_amount_usd: 850,
    fee_amount_usd: -27.5,
    payouts_total_usd: 2500,
    payouts_count: 1,
    net_activity_usd: 822.5,
    ending_balance_usd: 4700,
  },
  balance_explanation_april_2026_fees: {
    // Window: 2026-04-01 to 2026-04-29 ("this month").
    // Same in-window set minus bt_stripe_fee's date check (apr_01 is included).
    // Fees row: -$27.50 (count 3) — same as trailing-30d above.
    fee_amount_usd: -27.5,
    fee_count: 3,
  },
  customer_concentration_trailing_12mo: {
    // 2025-04-29 → 2026-04-29: includes Oct 2025, March 2026, April 2026
    //   cus_acme: $1,000 + $2,000 + $800 = $3,800
    //   cus_gamma: $1,500
    //   cus_beta: $400
    //   cus_solo: $300
    //   cus_jenny_rosen: $245 (Apr 28)        ← Chunk C
    //   cus_jenny_smith: $100 (Feb 15)        ← Chunk C
    //   total: $6,345
    //   top_1: Acme $3,800 / $6,345 = 0.5990…
    // (Recalibrated 2026-05-01 / Chunk C.)
    top_1_customer_name: 'Acme Corp',
    top_1_amount: 3800,
    top_1_share: 0.5989913317573681,
    total_collected: 6345,
  },
  customer_lookup_jenny_disambiguation: {
    // Stripe Search exact "Jenny" returns 0 → prefix-fallback finds both
    // cus_jenny_rosen + cus_jenny_smith. Sort: most-recent-activity first
    // (Q9.1) — Jenny Rosen (apr_28) > Jenny Smith (feb_15).
    match_strategy: 'prefix_fallback' as const,
    rows: [
      {
        id: 'cus_jenny_rosen',
        display_name: 'Jenny Rosen',
        email: 'jenny@example.com',
        lifetime_collected: 245,
        most_recent_charge_at: T.apr_28_2026,
      },
      {
        id: 'cus_jenny_smith',
        display_name: 'Jenny Smith',
        email: 'jenny.smith@example.com',
        lifetime_collected: 100,
        most_recent_charge_at: T.feb_15_2026,
      },
    ],
  },
  customer_recent_activity_jenny_rosen_trailing_90d: {
    // Trailing 90d from FROZEN_NOW (apr 29 2026): jan 29 → apr 29.
    // ch_jr_1 (apr_28, $245) + in_advice (apr_28, $245 paid, Phase 2C-post)
    // both in window. 2 events total. No subscriptions/disputes for Jenny.
    customer_id: 'cus_jenny_rosen',
    customer_display_name: 'Jenny Rosen',
    expected_event_count: 2,
    most_recent_charge_amount: 245,
    most_recent_charge_iso: '2026-04-28',
  },
  // ── M2 Phase 2A ───────────────────────────────────────────────────────────
  arpu_recurring: {
    // MRR $1,400 USD ÷ active sub count 4 = $350
    arpu_usd: 350,
    source_revenue_usd: 1400,
    customer_count: 4,
    basis: 'recurring' as const,
  },
  arpu_collected_april: {
    // April 2026: collected_revenue $1,095 ÷ paying_customer_count 3 (2 ID + 1 guest) = $365
    arpu_usd: 365,
    source_revenue_usd: 1095,
    customer_count: 3,
    basis: 'collected' as const,
  },
  customer_recent_activity_acme_with_plan_change: {
    // cus_acme has: charges (ch_1 mar 5, ch_3 mar 20, ch_5 apr 10) +
    // invoice in_1 (mar 5) + subscription update event evt_acme_upgrade (apr 15)
    // + dispute dp_1 lost (mar 25). All in trailing 90d from apr 29.
    // The subscription_item_change event surfaces with description "Plan changed to Pro Monthly".
    customer_id: 'cus_acme',
    plan_change_iso: '2026-04-15',
    plan_changed_to: 'Pro Monthly',
  },
  customer_recent_activity_beta_with_upcoming_cancel: {
    // sub_beta has cancel_at_period_end=true, cancel_at=may_15_2026.
    // upcoming_cancellations: [{plan_name: 'Starter Monthly', cancels_at_iso: '2026-05-15'}]
    customer_id: 'cus_beta',
    upcoming_cancel_plan: 'Starter Monthly',
    upcoming_cancel_iso: '2026-05-15',
  },
  // ── M2 Phase 2C-pre ───────────────────────────────────────────────────────
  failed_payments_march: {
    // Charge-side: ch_4 ($300, card_declined), ch_failed_2 ($200,
    //   insufficient_funds), ch_failed_3 ($150, insufficient_funds)
    //   = $650 across 3 charges
    // Invoice-side: in_2 ($550 open, attempt_count=2),
    //   in_5 ($275 uncollectible, attempt_count=3)
    //   = $825 across 2 invoices
    // Combined: $1,475 / 5 failures
    // failure_reasons: insufficient_funds (2), card_declined (1)
    // top 5 by amount: in_2 ($550), in_5 ($275), ch_4 ($300),
    //   ch_failed_2 ($200), ch_failed_3 ($150)
    total_failed: 1475,
    count: 5,
    failed_charges_amount: 650,
    failed_charges_count: 3,
    failed_invoice_attempts_amount: 825,
    failed_invoice_attempts_count: 2,
    top_failure_amounts: [550, 300, 275, 200, 150],
    failure_reasons_top: 'insufficient_funds',
  },
} as const;
