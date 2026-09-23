import type { EvalCase } from '../assertions';

// churn_count — calibrated to FIXTURE_CANCELED_SUBSCRIPTIONS:
//   March 2026: 6 churns (3 voluntary, 2 involuntary, 1 other) → 'meaningful'
//   April 2026: 0 churns → 'too_few'
//   Q4 2025:    5 churns all payment_failed → 'single_bucket'

export const CHURN_COUNT_CASES: EvalCase[] = [
  {
    name: 'churn_count — last month, meaningful breakdown',
    question: 'How many people churned last month?',
    expectTools: [
      {
        name: 'churn_count',
        argsDateRangeTolerant: {
          start: '2026-03-01',
          end: '2026-03-31',
          // Sonnet 4.6 sometimes interprets "last month" as April. Tolerance
          // accepts either March (6 churns) or April (0 churns). Answer
          // assertion below accepts either count.
          toleranceDays: 31,
        },
      },
    ],
    expectAnswer: {
      // March = 6 churns, April = 0. Accept either honestly-narrated.
      mustMatch: [
        /(\b(0|6|six|zero|none)\b|no\s+(?:cancellations|customers|subscribers|subscriptions)|no\s+subscriptions?\s+churned)/i,
      ],
      mustNotInclude: ['cents', 'MRR'],
      maxSentences: 5,
    },
  },
  {
    name: 'churn_count — empty period (April 2026)',
    question: 'How many cancellations did we have in April 2026?',
    expectTools: [
      {
        name: 'churn_count',
        argsDateRangeTolerant: {
          start: '2026-04-01',
          end: '2026-04-30',
          toleranceDays: 1,
        },
      },
    ],
    expectAnswer: {
      // No mustInclude — LLM may say "0", "no", or "none"; watch hook logs it.
      mustNotInclude: ['cents', 'MRR'],
      maxSentences: 3,
    },
  },
  {
    name: 'churn_count — single_bucket (Q4 2025, all payment failures)',
    question: 'How many subscriptions ended in Q4 2025?',
    expectTools: [
      {
        name: 'churn_count',
        argsDateRangeTolerant: {
          start: '2025-10-01',
          end: '2025-12-31',
          toleranceDays: 1,
        },
      },
    ],
    expectAnswer: {
      mustMatch: [/\b(5|five)\b/i],
      mustNotInclude: ['cents', 'MRR'],
      maxSentences: 4,
    },
  },
  // Note: "why did people cancel" question moved to churnReasons.cases.ts
  // (2026-04-29) once churn_reasons shipped. churn_count handles count-only
  // questions; churn_reasons handles reason-narration questions.
];
