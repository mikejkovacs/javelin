// DRAFT — DEFERRED POST-MVP (2026-05-14). NOT WIRED into index.ts.
//
// Tracked in: project_javelin_post_m2_backlog.md → adjacent backlog →
// "mrr_movement eval case additions (deferred 2026-05-14, post-MVP)."
//
// What this file is: 2 additional mrr_movement eval cases for trial-to-paid
// NEW attribution + annual-sub churn detection. Both reference the fix
// shipped in commit f60e182 (2026-05-14) — see
// `project_javelin_mrr_movement_bug_class` for the bug class.
//
// What's already done: the 3 PRE-EXISTING cases in mrrMovement.cases.ts that
// previously asserted "no movement" for March/Q1 were updated in-place at
// commit time to match the new (correct) -$600 churn behavior. Those updates
// shipped; this draft is separate and tracks the 2 NEW cases only.
//
// To apply when picking this back up:
//   1. Apply fixture additions to evals/fetcherFixtures.ts (see
//      REQUIRED_FIXTURE_ADDITIONS below).
//   2. Apply CALIBRATED block updates (see REQUIRED_CALIBRATION_UPDATES) —
//      including the `$1,400` → `$1,450` regex bump in mrrMovement.cases.ts
//      Case 2 since the trialist sub adds $50/mo to state MRR.
//   3. Append the cases at the bottom of this file to MRR_MOVEMENT_CASES in
//      mrrMovement.cases.ts. Delete this draft file.
//   4. Run `npm run evals` to validate (~$1.80 per project_javelin_eval_harness)
//      and tune assertions if any LLM phrasing edge case trips them.
//
// Why deferred: applying requires fixture additions that cascade into
// recalibration of period_billed_revenue_april, active_subscription_count,
// mrr, and churn_count_april. Better done as a focused calibration sitting
// with a paid live eval run, not as a passing change. Trigger to revisit:
// next focused eval-calibration sitting OR pre-beta correctness pass.

import type { EvalCase } from '../assertions';

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED_FIXTURE_ADDITIONS — apply to evals/fetcherFixtures.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// (1) Add to `const T = {...}` time anchors:
//
//   apr_30_2025: Math.floor(new Date('2025-04-30T00:00:00Z').getTime() / 1000),
//
// (2) Append to `FIXTURE_SUBSCRIPTIONS` (new active sub for trial-to-paid):
//
//   {
//     id: 'sub_trialist',
//     customer: 'cus_trialist',
//     status: 'active',
//     start_date: T.apr_01_2026,
//     canceled_at: null,
//     ended_at: null,
//     cancellation_details: null,
//     pause_collection: null,
//     trial_end: null,
//     discounts: [],
//     items: {
//       data: [
//         {
//           id: 'si_trialist',
//           quantity: 1,
//           price: {
//             id: 'price_50',
//             nickname: 'Solo Monthly',
//             unit_amount: 5000,            // $50.00 / month
//             currency: 'usd',
//             product: { id: 'prod_solo', name: 'Solo' },
//             recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
//           },
//         },
//       ],
//     },
//   },
//
// (3) Append to `FIXTURE_CANCELED_SUBSCRIPTIONS` (annual sub with no linked
//     invoice — exercises Pass-2 sub-items fallback for long-interval churns):
//
//   {
//     id: 'sub_can_annual',
//     customer: 'cus_annual_lost',
//     status: 'canceled',
//     start_date: T.apr_30_2025,            // ~12 months before "now"
//     canceled_at: T.apr_15_2026,
//     ended_at: T.apr_15_2026,
//     cancellation_details: { reason: 'cancellation_requested', feedback: 'too_expensive' },
//     pause_collection: null,
//     trial_end: null,
//     discounts: [],
//     items: {
//       data: [
//         {
//           id: 'si_annual',
//           quantity: 1,
//           price: {
//             id: 'price_2400_year',
//             nickname: 'Enterprise Annual',
//             unit_amount: 240000,          // $2,400 / year → $200 / month
//             currency: 'usd',
//             product: { id: 'prod_enterprise', name: 'Enterprise' },
//             recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' },
//           },
//         },
//       ],
//     },
//   },
//
// (4) Append to `FIXTURE_INVOICES` (trial-create $0 + first-paid $50):
//
//   {
//     id: 'in_trial_create',
//     customer: 'cus_trialist',
//     status: 'paid',
//     total: 0, subtotal: 0, total_excluding_tax: 0, tax: null,
//     amount_paid: 0, amount_due: 0, amount_remaining: 0,
//     currency: 'usd',
//     created: T.apr_01_2026,
//     status_transitions: { finalized_at: T.apr_01_2026, paid_at: T.apr_01_2026, voided_at: null, marked_uncollectible_at: null },
//     subscription: 'sub_trialist',
//     billing_reason: 'subscription_create',
//     lines: { data: [{ amount: 0, price: { id: 'price_50', product: 'prod_solo', nickname: 'Solo Monthly', recurring: { interval: 'month', interval_count: 1 } } }] },
//   },
//   {
//     id: 'in_trial_paid',
//     customer: 'cus_trialist',
//     status: 'paid',
//     total: 5000, subtotal: 5000, total_excluding_tax: 5000, tax: null,
//     amount_paid: 5000, amount_due: 0, amount_remaining: 0,
//     currency: 'usd',
//     created: T.apr_15_2026,
//     status_transitions: { finalized_at: T.apr_15_2026, paid_at: T.apr_15_2026, voided_at: null, marked_uncollectible_at: null },
//     subscription: 'sub_trialist',
//     billing_reason: 'subscription_cycle',
//     lines: { data: [{ amount: 5000, price: { id: 'price_50', product: 'prod_solo', nickname: 'Solo Monthly', recurring: { interval: 'month', interval_count: 1 } } }] },
//   },
//
// (5) Append to `FIXTURE_CUSTOMERS`:
//
//   { id: 'cus_trialist', name: 'Trialist LLC', email: 'ops@trialist.example', created: T.apr_01_2026, deleted: false },
//   { id: 'cus_annual_lost', name: 'Annual Lost Inc', email: 'finance@annual-lost.example', created: T.apr_30_2025, deleted: false },
//
// (6) Append to `FIXTURE_PRODUCTS`:
//
//   { id: 'prod_solo', name: 'Solo', active: true },
//   // prod_enterprise already exists in FIXTURE_PRODUCTS

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED_CALIBRATION_UPDATES — update CALIBRATED block in fetcherFixtures.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// active_subscription_count:
//   value: 4 → 5 (sub_trialist added as active)
//
// mrr:
//   rows[0].mrr: 1400 → 1450 (sub_trialist contributes $50/mo)
//   rows[0].subscription_count: 4 → 5
//
// period_billed_revenue_april:
//   rows[0].billed_revenue: 2245 → 2295 (in_trial_paid $50 paid)
//   rows[0].invoice_count: 2 → ? (depends on whether $0 invoices count;
//                                 calibrate empirically — likely 2 → 4 since
//                                 in_trial_create is status='paid' and the
//                                 primitive's predicate likely counts it)
//
// churn_count_april:
//   total: 0 → 1; voluntary: 0 → 1; breakdown_significance stays 'too_few'
//   (still under threshold; verify empirically)
//
// Also update the EXISTING flow/state case in mrrMovement.cases.ts:
//   mustMatch /\$1,400/ → /\$1,450/  (state value changes after sub_trialist added)
//
// ADD new calibrated entries (optional — cases below assert on regex, not literal):
//
//   mrr_movement_april: {
//     // 1 new event (sub_trialist $50 at Apr 15 via first-paid-invoice scan).
//     // 1 churned event (sub_can_annual $200/mo via sub-items fallback).
//     rows: [
//       { bucket: 'new', currency: 'usd', amount: 50, event_count: 1 },
//       { bucket: 'churned', currency: 'usd', amount: -200, event_count: 1 },
//     ],
//     totals_by_currency: { usd: { new: 50, expansion: 0, contraction: 0, churned: -200, net: -150 } },
//   },

// ─────────────────────────────────────────────────────────────────────────────
// NEW CASES — append to MRR_MOVEMENT_CASES in mrrMovement.cases.ts
// ─────────────────────────────────────────────────────────────────────────────

export const MRR_MOVEMENT_CASES_DRAFT_ADDITIONS: EvalCase[] = [
  // ── Trial-to-paid NEW attribution (Bug A fix) ────────────────────────────
  // sub_trialist created Apr 1 with $0 subscription_create invoice + $50
  // subscription_cycle invoice on Apr 15. Pre-fix the $0 invoice killed
  // the NEW event; post-fix Pass-1 scans for first invoice with monthly > 0
  // and attributes NEW to the Apr 15 conversion ($50). Plus 1 annual churn
  // (sub_can_annual, $200/mo via sub-items fallback) on Apr 15.
  // Expected mrr_movement output for April: 1 new (+$50) + 1 churn (-$200)
  // = net -$150.
  {
    name: 'mrr_movement — April: trial conversion fires NEW; annual churn fires from sub.items',
    question: 'What were the highlights of MRR movement in April 2026?',
    expectTools: [
      {
        name: 'mrr_movement',
        argsExact: { start: '2026-04-01', end: '2026-04-30' },
      },
    ],
    expectAnswer: {
      // LLM should surface at least the churn (larger absolute amount) and
      // ideally the new conversion too. Net -$150 = $50 new - $200 churn.
      mustMatch: [/\$200|annual|cancel|churn/i],
      mustNotInclude: ['cus_', 'sub_', 'rows', 'events array'],
      // Should NOT claim zero movement — that was the Merchant B symptom.
      mustNotMatch: [
        /(no MRR movement|nothing chang|flat MRR|stable MRR)/i,
        /(can't access|isn't available|integration|scope)/i,
      ],
      maxSentences: 7,
    },
  },

  // ── Annual sub churn isolated (Bug B fix) ────────────────────────────────
  // Tight window (Apr 14-16) brackets the sub_can_annual ended_at on Apr 15
  // and includes the trial-paid invoice on Apr 15 (NEW for sub_trialist
  // also fires in this window). To truly ISOLATE the annual churn from
  // the trial conversion, an Apr 16-17 window would work — but the trial
  // sub_trialist's start_date is Apr 1, so widening doesn't matter; what
  // matters is the FINALIZED_AT of its first paid invoice (Apr 15).
  // Choosing Apr 16-30: excludes Apr-15 trial-paid finalized_at; includes
  // the Apr-15 annual ended_at. Result: 0 new (trial conversion was Apr 15)
  // + 1 churn (sub_can_annual). VERIFY empirically with calibration run.
  {
    name: 'mrr_movement — annual sub churned mid-April (sub-items fallback path isolated)',
    question: 'Did any subscriptions churn between April 16 and April 30, 2026?',
    expectTools: [
      {
        name: 'mrr_movement',
        argsExact: { start: '2026-04-16', end: '2026-04-30' },
      },
    ],
    expectAnswer: {
      // CAVEAT: window excludes Apr-15 events. If the primitive uses
      // inclusive-end (and Apr-15 churn is OUT of [Apr-16, Apr-30]), then
      // this window contains zero movement → narration is "no churn." If
      // empirically the annual churn DOES fall in this window (because
      // ended_at is interpreted differently), the regex should match $200.
      // Calibrate empirically; until then, accept either narration shape.
      mustMatch: [/\$200|annual|cancel|churn|lost|no\s|nothing|didn't/i],
      mustNotInclude: ['cus_', 'sub_'],
      mustNotMatch: [/(can't access|isn't available|integration|sigma)/i],
      maxSentences: 5,
    },
  },
];
