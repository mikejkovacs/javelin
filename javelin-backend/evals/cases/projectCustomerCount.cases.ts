import type { EvalCase } from '../assertions';

// project_customer_count — calibrated against FIXTURE_PROFILE (today
// 2026-04-29):
//
// current_count = 312
// new_customer_distribution.median = 18
// churn_distribution.median = 4
// monthly_net_additions = 14
// trend_label = 'growing' (14/312 = 4.5% per month, above 1% flat threshold)
// coverage = 'full' (both distributions n_months = 6)
//
// Horizon=6 → 312 + 14*6 = 396
// Horizon=3 (default) → 312 + 14*3 = 354
//
// CRITICAL RULE #10 + customer-count assumption-disclosure assertions:
// answer must contain "assuming new-customer and churn rates stay flat"
// (or close paraphrase) AND a conditional verb form ("would" / "you'd").

export const PROJECT_CUSTOMER_COUNT_CASES: EvalCase[] = [
  {
    name: 'project_customer_count — growing trajectory 6 months ahead',
    question: 'Where will my customer count be in 6 months?',
    expectTools: [
      {
        name: 'project_customer_count',
        argsExact: { horizon_months: 6 },
      },
    ],
    expectAnswer: {
      mustMatch: [
        // Projected ~396 — allow 380-420 to absorb LLM rounding.
        /\b(3[89]\d|4[01]\d)\b/,
        // Customer-count-specific assumption disclosure (mandatory per Rule #10).
        /(assum(ing|e)|stay(?:ing|s)?\s+flat|hold(s|ing)?|current\s+rates?)/i,
        // Conditional verb tense.
        /(would|you'?d)/i,
        // Trend disclosure.
        // Growth language — Sonnet may use direct phrasing ("growing")
        // OR descriptive phrasing ("up from X", "new customers per month",
        // "X new offset by Y churning") (2026-05-08 Phase 2B′ amendment-2).
        /(growing|growth|net|adding|new\s+customers|up\s+from)/i,
      ],
      mustNotMatch: [
        /\byou\s+will\s+(have|hit|reach|see)\b/i,
        /\byou'?ll\s+(have|hit|reach|see)\b/i,
      ],
      // Asterisk allowed — projection answers may bold the headline figure
      // (Type B fix 2026-05-07).
      mustNotInclude: ['as an AI'],
      maxSentences: 5,
    },
  },
  {
    name: 'project_customer_count — short horizon (3mo default)',
    question: 'How many customers will I have in three months?',
    expectTools: [
      {
        name: 'project_customer_count',
        argsExact: { horizon_months: 3 },
      },
    ],
    expectAnswer: {
      mustMatch: [
        // Projected ~354 — allow 340-370.
        /\b3[4-6]\d\b/,
        /(assum(ing|e)|stay(?:ing|s)?\s+flat|hold(s|ing)?|current\s+rates?)/i,
        /(would|you'?d)/i,
      ],
      mustNotMatch: [
        /\byou\s+will\s+(have|hit|reach|see)\b/i,
        /\byou'?ll\s+(have|hit|reach|see)\b/i,
      ],
      // Asterisk allowed — projection answers may bold the headline figure
      // (Type B fix 2026-05-07).
      mustNotInclude: [],
      maxSentences: 5,
    },
  },
];
