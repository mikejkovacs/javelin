import type { EvalCase } from '../assertions';

// active_subscription_count — calibrated to FIXTURE: 4 (same as mrr's
// subscription_count). Strict tool-count = 1 catches the failure mode where
// the LLM calls BOTH active_subscription_count AND mrr (the description tells
// it not to; this guards regression).

export const ACTIVE_SUBSCRIPTION_COUNT_CASES: EvalCase[] = [
  {
    name: 'active_subscription_count — distinct from mrr (no double-call)',
    question: 'How many active subscriptions do I have?',
    expectTools: [{ name: 'active_subscription_count', argsExact: {} }],
    expectAnswer: {
      mustInclude: ['4'],
      mustNotInclude: [
        '$1,400',     // shouldn't volunteer the dollar figure
        'MRR',        // shouldn't volunteer MRR framing (CRITICAL RULE #4)
        'cents',
      ],
      maxSentences: 5,
    },
  },
];
