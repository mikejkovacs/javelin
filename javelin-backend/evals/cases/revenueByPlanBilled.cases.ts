import type { EvalCase } from '../assertions';

// revenue_by_plan_billed — calibrated to FIXTURE:
//
// March 2026 (pure-SaaS shape — all revenue is invoice-billed):
//   Pro Monthly:     $1,000 (1 invoice — in_1 paid)
//   Starter Monthly: $750   (2 invoices — in_2 open $500 + in_5 uncollectible $250)
//   in_4 ($750 void) excluded
//   Total:           $1,750  (matches period_billed_revenue_march)
//
// April 2026 (mixed-merchant shape — both nickname and productById paths exercised):
//   Enterprise Monthly: $2,000 (1 invoice — in_3, nickname path)
//   Advice Access:      $245   (1 invoice — in_advice, productById fallback path)
//   Total:              $2,245 (matches period_billed_revenue_april)
//
// Rule #9 expects revenue-by-plan questions to call BOTH revenue_by_plan
// (charges side) AND revenue_by_plan_billed (invoices side); the LLM weaves
// both views in narration. expectTools omitted in these cases — LLM may also
// call additional sibling tools (e.g., period_collected_revenue) and that's
// fine. Answer content assertions verify the substance landed.

export const REVENUE_BY_PLAN_BILLED_CASES: EvalCase[] = [
  {
    name: 'revenue_by_plan_billed — March 2026 pure-SaaS-shape (all invoice revenue)',
    question:
      'Show me revenue by plan in March 2026 — the billed side.',
    expectAnswer: {
      // Pro Monthly $1,000 and Starter Monthly $750 must both surface.
      mustMatch: [
        /(pro monthly|Pro Monthly)/,
        /(starter monthly|Starter Monthly)/,
        /\$1,000/,
        /\$750/,
      ],
      mustNotInclude: ['cents', 'cus_', 'in_', 'price_', 'prod_'],
      maxSentences: 8,
    },
  },
  {
    name: 'revenue_by_plan_billed — April 2026 mixed-shape (nickname + productById both surface)',
    question:
      'Which plans drove my billed revenue in April 2026?',
    expectAnswer: {
      // Enterprise Monthly $2,000 (nickname path) and Advice Access $245
      // (productById fallback path) must both surface — proves both
      // resolution paths through the new primitive on the eval-mocked
      // fixture data.
      mustMatch: [
        /(enterprise monthly|Enterprise Monthly)/,
        /\$2,000/,
        /(advice access|Advice Access)/,
        /\$245/,
      ],
      mustNotInclude: ['cents', 'cus_', 'in_', 'price_', 'prod_'],
      maxSentences: 8,
    },
  },
];
