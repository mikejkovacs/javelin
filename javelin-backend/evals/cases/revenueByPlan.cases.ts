import type { EvalCase } from '../assertions';

// revenue_by_plan — calibrated to FIXTURE (March 2026, USD):
//   Pro Monthly:     $1,000 (1 charge — ch_1 → in_1)
//   Starter Monthly: $400   (1 charge — ch_2 → in_2, post-refund)
//   unattributed:    $2,300 (2 charges — ch_3, ch_7 with invoice null)
//   Total:           $3,700
// April 2026:
//   Enterprise Monthly: $800 (1 charge — ch_5 → in_3)
//   unattributed:        $50 (1 charge — ch_guest with invoice null)
//   Total:               $850

export const REVENUE_BY_PLAN_CASES: EvalCase[] = [
  {
    name: 'revenue_by_plan — last month, multiple plans + unattributed',
    // Question explicit on March to avoid Sonnet's "last month = April"
    // interpretation drift (2026-05-07 Phase 2B′ — "last month" rephrased to
    // "in March 2026" for the calibration anchor).
    question: 'Show me revenue by plan in March 2026.',
    expectAnswer: {
      mustInclude: ['Pro Monthly', 'Starter Monthly'],
      mustMatch: [
        /(pro monthly[\s\S]{0,80}(\$1,000|27%)|(\$1,000|27%)[\s\S]{0,80}pro monthly)/i,
        /(starter monthly[\s\S]{0,80}(\$400|11%)|(\$400|11%)[\s\S]{0,80}starter monthly)/i,
      ],
      mustNotInclude: ['cents', 'cus_', 'in_', 'price_'],
    },
  },
  {
    name: 'revenue_by_plan — April with single plan + unattributed',
    question: 'Which plan made the most money in April 2026?',
    // expectTools dropped 2026-04-30 (Rule #9) — same reason as above.
    expectAnswer: {
      mustInclude: ['Enterprise Monthly', '$800'],
      // Asterisk allowed — system prompt mandates `- **Label** —` markdown
      // bullets for 3+ item lists (Type B fix 2026-05-07).
      mustNotInclude: ['cents', 'cus_', 'in_', 'price_'],
      maxSentences: 5,
    },
  },
  {
    // Phase 2C-post — exercises the product-name fallback path. ch_jr_1
    // ($245 April) is linked to in_advice, whose price has nickname:null +
    // product:'prod_advice_access'. revenueByPlan resolves attribution via
    // the productById map → 'Advice Access'. Validates end-to-end:
    // fetchProducts wired → primitive joins → LLM narrates.
    name: 'revenue_by_plan — April product-name fallback (Advice Access)',
    question: 'Show me revenue by plan in April 2026.',
    expectAnswer: {
      // Both nickname-path (Enterprise Monthly $800) and productById-path
      // (Advice Access $245) must surface. Tests both resolution paths
      // working together in one answer.
      mustMatch: [
        /(advice access|Advice Access)/,
        /\$245/,
        /(enterprise monthly|Enterprise Monthly)/,
        /\$800/,
      ],
      mustNotInclude: ['cents', 'cus_', 'in_', 'price_', 'prod_'],
      maxSentences: 8,
    },
  },
  // ── Phase 2C — series mode ──────────────────────────────────────────────
  // FIXTURE recap for series cases: USD charges land March (Pro $1,000,
  // Starter $400 net, unattributed $2,300) and April (Enterprise $800,
  // unattributed $50). Jan/Feb USD empty.
  {
    name: 'revenue_by_plan — series, monthly trend Q1 2026 → April',
    question: 'How are my plans trending month over month from January through April 2026?',
    // expectTools omitted — Sonnet may pair with period_billed_revenue per Rule #9
    // even with explicit-trend phrasing. The answer assertions cover the substance.
    expectAnswer: {
      // March numbers are the calibrated anchors; loose match on plan names + March amounts.
      mustMatch: [
        /pro monthly/i,
        /(starter monthly|unattributed)/i,
        /\$1,000/,                                  // Pro Monthly March
      ],
      mustNotInclude: ['cents', 'cus_', 'ch_', 'in_', 'price_', 'bucket'],
      // Loose cap — series narration spans multiple plans across multiple months.
      maxSentences: 12,
    },
  },
  {
    name: 'revenue_by_plan — series, weekly granularity inside March 2026',
    question: 'Show me weekly revenue by plan within March 2026.',
    expectAnswer: {
      // Pro Monthly $1,000 and unattributed $2,300 are the dominant entries;
      // weekly distribution should surface at least one of them.
      mustMatch: [
        /pro monthly/i,
        /(\$1,000|\$2,300|\$400)/,
      ],
      mustNotInclude: ['cents', 'cus_', 'ch_', 'in_', 'price_'],
      mustNotMatch: [
        // Sparse-narration anti-pattern guard: don't enumerate every empty week.
        /no charges[\s\S]{0,30}no charges[\s\S]{0,30}no charges/i,
      ],
      maxSentences: 12,
    },
  },
  {
    name: 'revenue_by_plan — series cap rejection, daily over trailing year',
    // Trailing 12 months from "today" 2026-04-29 = ~365 daily buckets, well
    // over the 90-day cap. The tool should error with a fall-back hint; the
    // LLM should retry with week or month and answer cleanly. This case
    // exercises the Sonnet's adaptive-retry behavior, not the literal answer.
    question: 'Show me daily revenue by plan for the trailing 12 months.',
    expectAnswer: {
      // Plan names should still surface (after fall-back to coarser granularity).
      mustMatch: [/(pro monthly|enterprise monthly|starter monthly|unattributed)/i],
      mustNotInclude: ['cents', 'cus_', 'ch_', 'in_', 'price_'],
      // Don't allow raw error verbatim leak.
      mustNotMatch: [/granularity supports a max/i, /tool call failed/i],
      maxSentences: 14,
    },
  },
];
