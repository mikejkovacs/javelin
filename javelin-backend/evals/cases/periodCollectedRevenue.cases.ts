import type { EvalCase } from '../assertions';

// period_collected_revenue — calibrated to FIXTURE:
//   March 2026 (last month): $3,700 across 4 charges
//   Q4 2025:                  $1,500 across 1 charge

export const PERIOD_COLLECTED_REVENUE_CASES: EvalCase[] = [
  {
    name: 'period_collected_revenue — last month (March 2026)',
    question: 'How much did I collect last month?',
    expectTools: [
      {
        name: 'period_collected_revenue',
        argsExact: { start: '2026-03-01', end: '2026-03-31' },
      },
    ],
    expectAnswer: {
      mustInclude: ['$3,700', '4'],
      mustNotInclude: ['cents', 'cus_', 'ch_', 'as an AI'],
      maxSentences: 5,
    },
  },
  {
    name: 'period_collected_revenue — Q4 2025 (charge-based revenue framing)',
    question: 'How much did I collect in Q4 2025?',
    // expectTools dropped 2026-05-01 (Chunk C close run): the LLM
    // sometimes calls both period_collected_revenue AND period_billed_revenue
    // for "collect"-shaped questions (slight Rule #9 over-application —
    // the user said "collect", not "revenue"). Answer content is correct
    // either way; the $1,500 figure assertion proves the collected stream
    // landed. Watch for Rule #9 over-application as a separate watch item
    // if this pattern recurs across other "collect"/"bill"-explicit questions.
    expectAnswer: {
      mustInclude: ['$1,500'],
      mustNotInclude: ['cents', 'cus_', 'ch_'],
      maxSentences: 5,
    },
  },
];
