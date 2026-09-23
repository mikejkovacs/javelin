import type { EvalCase } from '../assertions';

// customer_spend_distribution — calibrated to FIXTURE.
//
// Trailing 12mo USD per-customer totals (sorted asc):
//   $100 (jenny_smith), $245 (jenny_rosen), $300 (solo), $400 (beta),
//   $1,500 (gamma), $3,800 (acme)
// → n=6, median = (300+400)/2 = 350, mean = 6345/6 = 1057.5
// → low_sample = false
//
// March-only USD per-customer totals (sorted asc):
//   $300 (solo), $400 (beta), $3,000 (acme)
// → n=3, median = 400 (middle)
// → low_sample = true (count < 5)

export const CUSTOMER_SPEND_DISTRIBUTION_CASES: EvalCase[] = [
  {
    name: 'customer_spend_distribution — trailing 12 months happy path',
    question: 'What is my customer spend distribution in the trailing 12 months?',
    expectTools: [
      {
        name: 'customer_spend_distribution',
        argsDateRangeTolerant: {
          start: '2025-04-29',
          end: '2026-04-29',
          toleranceDays: 2,
        },
      },
    ],
    expectAnswer: {
      // Median is the headline figure; should appear in the narration.
      mustMatch: [/350|\$350/],
      mustNotInclude: ['cus_', 'cents'],
    },
  },
  {
    name: 'customer_spend_distribution — small period flags low_sample',
    question: "What's the median customer spend in March 2026?",
    expectTools: [
      {
        name: 'customer_spend_distribution',
        argsDateRangeTolerant: {
          start: '2026-03-01',
          end: '2026-03-31',
          toleranceDays: 0,
        },
      },
    ],
    expectAnswer: {
      // n=3 → low_sample, median=400. Answer should disclose the small sample
      // somehow ("only 3 paying customers", "small sample", etc.). Loose match
      // because phrasing varies.
      mustInclude: ['400'],
      mustMatch: [/(small sample|few customers|only \d|3 paying|low sample)/i],
    },
  },
];
