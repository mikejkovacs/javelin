import type { EvalCase } from '../assertions';

// failed_payments — calibrated to FIXTURE (March 2026, USD):
//   Charge-side: ch_4 ($300, card_declined), ch_failed_2 ($200,
//     insufficient_funds), ch_failed_3 ($150, insufficient_funds)
//     = $650 across 3 failed charges
//   Invoice-side: in_2 ($550 open, attempt_count=2),
//     in_5 ($275 uncollectible, attempt_count=3)
//     = $825 across 2 failed invoice attempts
//   Combined: $1,475 / 5 failures
//   failure_reasons: insufficient_funds (2 charges), card_declined (1 charge)
//
// April 2026: empty period for failures (no failed charges, no open/uncoll
// invoices in window with attempt_count > 0).

export const FAILED_PAYMENTS_CASES: EvalCase[] = [
  {
    name: 'failed_payments — March 2026 with charges + invoice attempts',
    question: 'What were my failed payments in March?',
    expectTools: [
      {
        name: 'failed_payments',
        argsDateRangeTolerant: {
          start: '2026-03-01',
          end: '2026-03-31',
          // Sonnet sometimes interprets "in March" as a clear period vs
          // "last month" tolerance pattern; March-specific is unambiguous.
          toleranceDays: 1,
        },
      },
    ],
    expectAnswer: {
      // Total failed = $1,475. Sonnet may surface total OR per-stream split.
      // Allow either headline.
      mustMatch: [
        // Either the total ($1,475 / $1,500 rounded) OR a meaningful subtotal
        // appears in the answer.
        /\$(1,475|1,500|650|825|550|300)/,
        // Failure reason narration somewhere — top reason or "fail" word
        /(failed|failure|insufficient|declined)/i,
      ],
      mustNotInclude: ['cents', 'cus_', 'ch_', 'in_'],
      maxSentences: 6,
    },
  },
  {
    name: 'failed_payments — operator-framing question routes here',
    question: 'How much money did I miss out on last month?',
    expectAnswer: {
      // Sonnet should recognize "miss out on" / "money I was supposed to get"
      // as the operator framing for failed_payments. Accept either:
      //   (a) a dollar figure (when failures exist), OR
      //   (b) an empty-state narration ("no failed payments", "none", etc.)
      //     when the resolved period (March or April depending on Sonnet's
      //     "last month" interpretation) has zero failures.
      mustMatch: [/(\$\d|no failed|none|nothing|zero|all.*went through)/i],
      mustNotInclude: ['cents'],
      maxSentences: 6,
    },
  },
  {
    name: 'failed_payments — top_n custom value',
    question: 'Show me my top 3 largest failed payments in March 2026.',
    expectTools: [
      {
        name: 'failed_payments',
        argsDateRangeTolerant: {
          start: '2026-03-01',
          end: '2026-03-31',
          toleranceDays: 1,
          otherArgsExact: { top_n: 3 },
        },
      },
    ],
    expectAnswer: {
      // The top 3 by amount: $550 (in_2), $300 (ch_4), $275 (in_5)
      mustMatch: [/\$(550|300|275)/],
      mustNotInclude: ['cents', 'in_', 'ch_'],
      maxSentences: 5,
    },
  },
];
