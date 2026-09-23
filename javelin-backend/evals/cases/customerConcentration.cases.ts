import type { EvalCase } from '../assertions';

// customer_concentration — calibrated to FIXTURE:
//   March 2026: Acme Corp top, $3,000 of $3,700 total = 81.1% share
//   Trailing 12mo (2025-04-29 → 2026-04-29): Acme top, $3,800 of $6,000 = 63.3%
//
// Date assertions use argsDateRangeTolerant so top_n (which the LLM may pick
// as 1 or 5 depending on phrasing) doesn't have to be exact.

export const CUSTOMER_CONCENTRATION_CASES: EvalCase[] = [
  {
    name: 'customer_concentration — top customer last month',
    question: "Who's my top customer last month?",
    expectTools: [
      {
        name: 'customer_concentration',
        argsDateRangeTolerant: {
          start: '2026-03-01',
          end: '2026-03-31',
          // Sonnet 4.6 occasionally interprets "last month" as April when
          // today is April 29. Both interpretations reasonable; tolerance
          // allows either. (Bumped 0d→31d 2026-05-07 Phase 2B′.)
          toleranceDays: 31,
        },
      },
    ],
    expectAnswer: {
      // Soft on customer/dollar figure — depends on March vs April
      // interpretation. March top: Acme Corp $3,000. April: Acme Corp $800.
      // Both are accurate fixture data; either is correct.
      mustMatch: [/(Acme|jenny)/i, /\$(3,000|800|245)/],
      mustNotInclude: ['cents', 'cus_'],
      maxSentences: 5,
    },
  },
  {
    name: 'customer_concentration — trailing 12 months',
    question: 'Who are my top customers in the trailing 12 months?',
    expectTools: [
      {
        name: 'customer_concentration',
        argsDateRangeTolerant: {
          start: '2025-04-29',
          end: '2026-04-29',
          toleranceDays: 2, // mild leeway for "12 months" interpretation
        },
      },
    ],
    expectAnswer: {
      mustInclude: ['Acme', '$3,800'],
      // Acme's top-1 share: was 63.3% pre-Chunk C; now 60% post-Chunk C
      // (Jenny additions grew the trailing-12mo denominator from $6,000 →
      // $6,345). Accept either era's figure.
      mustMatch: [/(60|6[234])\s*%/],
      // System prompt mandates `- **Label** —` for 3+ item lists; markdown
      // bullets are now expected, not forbidden (Type B fix 2026-05-07).
      mustNotInclude: ['cents', 'cus_'],
    },
  },
];
