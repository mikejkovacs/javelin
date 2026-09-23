import type { EvalCase } from '../assertions';

// balance_explanation — calibrated against FIXTURE_BALANCE + extended
// FIXTURE_BALANCE_TRANSACTIONS. Frozen "today" = 2026-04-29.
//
// Trailing 30 days window (case 1):
//   2026-03-30 to 2026-04-29
//   In-window BTs:
//     bt_stripe_fee  (2026-04-01)  fee  amount -$2
//     bt_5           (2026-04-10)  charge amount $800, fee $24
//     bt_guest       (2026-04-10)  charge amount $50, fee $1.50
//     bt_payout_apr  (2026-04-15)  payout net -$2,500
//   Activity (excluding payouts):
//     charge: $850 (count 2)
//     fee:    -$27.50 (standalone -$2 merged with synth -$25.50 from per-charge fees, count 3)
//   Payouts: $2,500 (count 1)
//   net_activity = $822.50; starting = $6,377.50; ending = $4,700
//
// April 2026 fees window (case 2):
//   2026-04-01 to 2026-04-29 (same in-window set as above)
//   Same fee row: -$27.50 (count 3)

export const BALANCE_EXPLANATION_CASES: EvalCase[] = [
  {
    name: 'balance_explanation — last 30 days narrative',
    question: 'Where did my balance go in the last 30 days?',
    expectTools: [
      {
        name: 'balance_explanation',
        argsDateRangeTolerant: {
          start: '2026-03-30',
          end: '2026-04-29',
          toleranceDays: 2,
        },
      },
    ],
    expectAnswer: {
      // Must mention at least 2 of the canonical balance-summary categories
      // OR a payout figure (which Stripe-canonical lists separately). The
      // payout outflow is the largest single move so it's hard to miss.
      mustMatch: [
        /(charge|charges|payout|payouts|fee|fees|refund|refunds)/i,
        /(\$2,?500|\$850|\$4,?700|\$6,?377)/,
      ],
      // Asterisk allowed — narrative naturally lists category drivers as
      // bullets per system prompt (Type B fix 2026-05-07).
      mustNotInclude: ['bt_', 'reporting_category'],
      maxSentences: 6,
    },
  },
  {
    name: 'balance_explanation — Stripe fees this month',
    question: "How much have I paid in Stripe fees this month?",
    expectTools: [
      {
        name: 'balance_explanation',
        argsDateRangeTolerant: {
          start: '2026-04-01',
          end: '2026-04-29',
          toleranceDays: 1,
        },
      },
    ],
    expectAnswer: {
      // Calibrated fee total = $27.50. Accept rounded variants ($27, $28,
      // $27.50). LLM may render as positive ("you paid $27.50 in fees") or
      // qualitative; require a literal dollar figure regardless.
      mustMatch: [/\$2[78](\.50)?/],
      mustNotInclude: ['bt_'],
      maxSentences: 4,
    },
  },
];
