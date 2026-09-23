import type { EvalCase } from '../assertions';

// period_net_revenue — calibrated to FIXTURE:
//   March 2026: $3,500 net = $3,800 gross − $100 refunds − $200 chargebacks
//   (won dispute dp_2 in February correctly excluded by status filter)

export const PERIOD_NET_REVENUE_CASES: EvalCase[] = [
  {
    name: 'period_net_revenue — last month after refunds and chargebacks',
    question: 'What was my net revenue last month after refunds and chargebacks?',
    expectTools: [
      {
        name: 'period_net_revenue',
        argsExact: { start: '2026-03-01', end: '2026-03-31' },
      },
    ],
    expectAnswer: {
      mustInclude: ['$3,500'],
      // The interpreter may surface gross/refunds/chargebacks; we don't
      // strictly require those numbers but if they appear they must match.
      mustNotInclude: ['cents', 'dp_', 'cus_'],
      maxSentences: 5,
    },
  },
  {
    // M2 Phase 2A — fraud-filter parameter wiring. Asserts the LLM translates
    // "after fraud" / "minus fraud" / "real numbers" / "actuals" into
    // exclude_fraud=true. No fixture-side fraud charges, so the answer math
    // matches the unfiltered case ($3,500); soft on tool-call args only.
    name: 'period_net_revenue — exclude_fraud flag wired from "real numbers" framing',
    question: 'What was my real revenue last month after fraud?',
    expectTools: [
      {
        name: 'period_net_revenue',
        argsExact: {
          start: '2026-03-01',
          end: '2026-03-31',
          exclude_fraud: true,
        },
      },
    ],
    expectAnswer: {
      // Soft answer assertion — the dollar figure is the same as without
      // fraud (fixture has no fraudulent charges). What matters here is
      // tool-arg routing.
      mustInclude: ['$3,500'],
      mustNotInclude: ['cents', 'cus_'],
      maxSentences: 5,
    },
  },
];
