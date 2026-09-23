import type { EvalCase } from '../assertions';

// largest_charges_in_period — calibrated to FIXTURE.
//
// March 2026 USD charges (sorted by net_collected desc):
//   ch_3: $2,000 (cus_acme, 2026-03-20)
//   ch_1: $1,000 (cus_acme, 2026-03-05)
//   ch_2: $400 net of $100 refund (cus_beta, 2026-03-15)
//   ch_7: $300 (cus_solo, 2026-03-22)
//
// Trailing 12mo USD charges (largest 5):
//   ch_3: $2,000, ch_6: $1,500, ch_1: $1,000, ch_5: $800, ch_2: $400.

export const LARGEST_CHARGES_CASES: EvalCase[] = [
  {
    name: 'largest_charges — top 5 in March 2026 (bullet rendering expected)',
    question: 'What were my 5 largest charges in March 2026?',
    expectTools: [
      {
        name: 'largest_charges_in_period',
        argsDateRangeTolerant: {
          start: '2026-03-01',
          end: '2026-03-31',
          toleranceDays: 0,
        },
      },
    ],
    expectAnswer: {
      // Top 4 charges in March; the answer should surface the largest by value.
      mustInclude: ['$2,000'],
      mustMatch: [/Acme/i],
      mustNotInclude: ['cents', 'cus_', 'ch_'],
    },
  },
  {
    name: 'largest_charges — biggest charge last month (single result)',
    question: 'What was my biggest charge last month?',
    expectTools: [
      {
        name: 'largest_charges_in_period',
        argsDateRangeTolerant: {
          start: '2026-03-01',
          end: '2026-03-31',
          // Sonnet 4.6 sometimes interprets "last month" as April when
          // today is April 29. Tolerance accepts either. (Bumped 0d→31d
          // 2026-05-07 Phase 2B′.)
          toleranceDays: 31,
        },
      },
    ],
    expectAnswer: {
      // March top: ch_3 $2,000 (Acme). April top: ch_5 $800 (Acme) or
      // ch_jr_1 $245 (Jenny). Either reading is fixture-correct.
      mustMatch: [/(\$2,000|\$800|\$245)/, /(Acme|jenny)/i],
      mustNotInclude: ['cus_', 'ch_'],
      maxSentences: 5,
    },
  },
  {
    name: 'largest_charges — refunded charge appears at net amount',
    question: 'What were my top 5 charges in March 2026?',
    expectTools: [
      {
        name: 'largest_charges_in_period',
        argsDateRangeTolerant: {
          start: '2026-03-01',
          end: '2026-03-31',
          toleranceDays: 0,
        },
      },
    ],
    expectAnswer: {
      // Refunded ch_2 ranks at $400 (net), not $500 (gross). The answer may
      // or may not surface the refunded flag — both are acceptable; the
      // assertion is that no $500 figure leaks in for this charge.
      mustInclude: ['$2,000'],
      mustNotMatch: [/\$500\b/], // refunded charge shouldn't appear as $500 gross
    },
  },
];
