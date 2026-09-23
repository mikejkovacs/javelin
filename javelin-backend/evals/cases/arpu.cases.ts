import type { EvalCase } from '../assertions';

// arpu — calibrated to FIXTURE:
//   recurring: MRR $1,400 ÷ 4 active subs = $350
//   collected (April): $1,095 ÷ 3 customers (2 ID + 1 guest) = $365

export const ARPU_CASES: EvalCase[] = [
  {
    name: 'arpu — recurring basis from generic ARPU question',
    question: "What's my ARPU?",
    // Tool selection is non-deterministic for hybrid framing; the LLM may
    // call recurring only, or both bases. Don't strict-pin tool calls.
    expectAnswer: {
      // Either lens cites a per-customer dollar figure. Soft assertion.
      mustMatch: [/\$\s*\d/],
      mustNotInclude: ['cents', 'cus_', 'sub_'],
      maxSentences: 8,
    },
  },
  {
    name: 'arpu — recurring basis explicit (run-rate framing)',
    question: 'What does each active subscriber pay me on average per month?',
    expectAnswer: {
      // Recurring ARPU = $350. The LLM may say $350 or "around $350".
      mustMatch: [/\$\s*350/],
      mustNotInclude: ['cents'],
      maxSentences: 5,
    },
  },
  {
    name: 'arpu — collected basis from period-bounded framing',
    question: 'What did each customer pay me on average in April 2026?',
    expectAnswer: {
      // Collected ARPU April = $365. LLM may round; assert digits 36 followed
      // by 0-9 to allow $365 / $364.99 / $365.00 / "about $365".
      mustMatch: [/\$\s*36\d/],
      mustNotInclude: ['cents'],
      maxSentences: 5,
    },
  },
];
