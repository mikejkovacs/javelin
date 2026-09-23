import type { EvalCase } from '../assertions';

// MRR — calibrated to FIXTURE: $1,400 across 4 subs (3 active + 1 past_due,
// past_due contributes per the contributes_to_mrr rule).

export const MRR_CASES: EvalCase[] = [
  {
    name: 'mrr — basic question, calibrated value, voice rules',
    question: "What's my MRR?",
    expectTools: [{ name: 'mrr', argsExact: {} }],
    expectAnswer: {
      mustInclude: ['$1,400', '4'],
      mustNotInclude: [
        // Asterisk allowed — Sonnet bolds key figures and the frontend
        // markdown parser renders **bold** as visual bold (Type B fix 2026-05-07).
        'cents',      // no raw cent values (CRITICAL RULE #3)
        'cus_',       // no Stripe IDs in output
        'sub_',
        'price_',
        'as an AI',   // no preamble (VOICE rule)
      ],
      maxSentences: 5,
    },
  },
];
