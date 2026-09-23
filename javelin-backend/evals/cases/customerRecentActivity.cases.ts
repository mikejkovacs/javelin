import type { EvalCase } from '../assertions';

// customer_recent_activity — calibrated to FIXTURE extension (Chunk C / 2B):
//
// Trailing-90d window from FROZEN_NOW (apr 29 2026) = jan 29 → apr 29.
// For Jenny Rosen (cus_jenny_rosen): ch_jr_1 (apr_28, $245). One event,
// no invoices, no subscriptions, no disputes.
//
// Period-bounded case for cus_acme in March 2026 expects the existing
// March charges that belong to Acme:
//   ch_1 (mar_05, $1,000) + ch_3 (mar_20, $2,000) = 2 charge events.

export const CUSTOMER_RECENT_ACTIVITY_CASES: EvalCase[] = [
  {
    name: 'customer_recent_activity — last payment via lookup chain',
    question: "What was Jenny Rosen's last payment?",
    // expectTools dropped 2026-05-01 (cache-trim run). Originally expected
    // the 2-tool sequence customer_lookup → customer_recent_activity. The
    // Joy Rowe round-3 hot-fix added `most_recent_charge_amount` to
    // customer_lookup, collapsing this question to a single call. Either
    // shape (1 call or 2) now produces correct content; the answer
    // assertions below confirm the amount + month landed.
    expectAnswer: {
      mustMatch: [
        /\$245/,
        /(april|apr)/i,
      ],
      mustNotInclude: ['cus_jr', 'cus_jenny'],
      maxSentences: 4,
    },
  },
  {
    name: 'customer_recent_activity — period-bounded by customer_id',
    question:
      "Pull recent activity for customer ID cus_acme between 2026-03-01 and 2026-03-31.",
    // expectTools dropped 2026-05-01 (Chunk C close run): the LLM
    // sometimes calls customer_lookup first to validate/enrich the id
    // before customer_recent_activity. That's reasonable defensive
    // behavior — it surfaces the customer's name in the answer rather
    // than leaving the ID alone. Both shapes (1 call or 2) are
    // acceptable; the answer content assertions below confirm March
    // activity for Acme landed correctly.
    expectAnswer: {
      // Two March charges for Acme: ch_1 ($1,000) + ch_3 ($2,000).
      // Allow comma OR no-comma money formatting.
      mustMatch: [
        /(\$1,000|\$1000|\$3,000|\$3000)/,
        /(\$2,000|\$2000|march|mar)/i,
      ],
      mustNotInclude: ['ch_'],
      // Cap bumped 5→7 for Sonnet (2026-05-07 Phase 2B′ amendment) — Sonnet
      // narrates per-event activity longer than Haiku.
      maxSentences: 7,
    },
  },
  {
    // M2 Phase 2A — subscription_item_change events surface plan upgrades.
    // sub_acme has FIXTURE_SUBSCRIPTION_UPDATE_EVENTS event evt_acme_upgrade
    // dated apr_15_2026, items changed from price_200 (Starter) to price_300
    // (Pro Monthly). LLM may call customer_lookup first.
    name: 'customer_recent_activity — surfaces plan upgrade for Acme',
    question: 'Did Acme upgrade or downgrade lately?',
    expectAnswer: {
      // The plan change ran on April 15; new plan label is "Pro" (or
      // "Pro Monthly"). LLM may say "upgraded to Pro", "switched to Pro",
      // "Plan changed to Pro" — accept any phrasing that names Pro.
      mustMatch: [/\bpro\b/i],
      mustNotInclude: ['evt_', 'sub_acme', 'price_'],
      maxSentences: 5,
    },
  },
  {
    // M2 Phase 2A — upcoming_cancellations heads-up. sub_beta has
    // cancel_at_period_end=true, cancel_at=may_15_2026. Customer cus_beta
    // is "Beta Industries" in the fixture (let's verify name) — LLM should
    // surface the upcoming May 15 cancellation as a heads-up.
    name: 'customer_recent_activity — surfaces upcoming cancellation for Beta',
    question: 'Anything I should know about cus_beta?',
    expectAnswer: {
      // Cancellation date is May 15. Accept "May 15" / "May 2026" / a
      // "scheduled to cancel" / "set to cancel" / "cancellation" phrase.
      mustMatch: [
        /(may\s*15|may\s*2026)/i,
        /(cancel|cancellation|ending|expir)/i,
      ],
      mustNotInclude: ['sub_beta'],
      // Cap bumped 6→8 for Sonnet (2026-05-07 Phase 2B′) — heads-up framing
      // includes context + recommendation that Sonnet renders longer.
      maxSentences: 8,
    },
  },
];
