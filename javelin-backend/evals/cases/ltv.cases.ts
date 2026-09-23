import type { EvalCase } from '../assertions';

// ltv — Phase 2F coverage.
//
// Eval philosophy: the primitive's math is validated precisely in
// `lib/metrics/ltv.test.ts` (14 surgical tests covering all coverage
// states + the Stripe-published example reproduction + windowed-churn
// transitions). These eval cases instead validate LLM BEHAVIOR:
//   - Tool selection on direct LTV questions
//   - Default-window zero-churn narration WITH offer-to-widen action
//   - Proactive widening in a single turn (case 5 — locked at design lock)
//   - User-specified wider window narration WITH deviation hedge
//   - Scope clarity (subscription LTV vs all-customer revenue)
//   - Composition with other tools when question is open-ended
//
// Production validation on Merchant A (post-deploy) is the integration
// test against real Stripe data — Merchant A will hit the zero-churn
// case on default 30d window almost certainly.

export const LTV_CASES: EvalCase[] = [
  {
    name: 'ltv — tool selection on direct question',
    question: "What's the lifetime value of a customer?",
    expectTools: [{ name: 'ltv', argsExact: {} }],   // default 30d window
    expectAnswer: {
      // Must signal subscription/MRR scope (Path Z scope-flag pattern)
      mustMatch: [/(subscription|recurring|MRR|subscriber)/i],
      // "rows" removed from mustNotInclude — too common a word for LTV
      // narrative ("across all rows", etc.); the data-shape leak risk is
      // already covered by cus_/sub_/cents guards. Internal envelope field
      // names (low_sample, coverage) are a separate concern watched in PCL.
      mustNotInclude: ['cents', 'cus_', 'sub_'],
      maxSentences: 10,
    },
  },
  {
    name: 'ltv — default 30d window zero-churn narration offers wider window',
    question: "What's my customer LTV?",
    // expectTools omitted — LLM may call ltv once OR may proactively retry
    // with a wider window in the same turn (covered by case 5 below).
    expectAnswer: {
      // When 30d returns null, the LLM should narrate the limitation +
      // either offer to widen OR have widened proactively. When 30d returns
      // a computed value with low_sample=true, the LLM may instead surface
      // the value with a small-sample hedge (post-2026-05-13 LTV
      // description tightening — see PCL Session 2). Accept either shape.
      mustMatch: [
        /(no.*churn|haven't|hasn't|no observed|no estimate|wider|90.?day|365.?day|year|directional|small subscriber base|stabilize|small.*sample)/i,
      ],
      mustNotMatch: [
        /(can't access|isn't available|integration|broken|fabricat)/i,
        /\brows\b/i,
        /\barrays?\b/i,
      ],
      mustNotInclude: ['cents'],
      maxSentences: 10,
    },
  },
  {
    name: 'ltv — user-specified 90d window with deviation hedge',
    question: 'Show me my customer LTV using a 90-day churn window.',
    expectTools: [{ name: 'ltv', argsExact: { churn_window: '90d' } }],
    expectAnswer: {
      // Must hedge the deviation from Stripe Dashboard
      mustMatch: [/(diverge|wider|differs|smoother|stripe.*dashboard|90.?day|differs.*stripe|not.*stripe)/i],
      mustNotInclude: ['rows', 'cents', 'cus_'],
      maxSentences: 10,
    },
  },
  {
    name: 'ltv — user-specified 365d window narrates annual lens',
    question: 'What is my LTV computed over an annual churn window?',
    expectTools: [{ name: 'ltv', argsExact: { churn_window: '365d' } }],
    expectAnswer: {
      // Must surface that the 365d window deviates from Stripe Dashboard
      // OR explicitly narrate the annual / 365-day framing
      mustMatch: [/(365.?day|annual|year|wider|diverge|differs)/i],
      mustNotInclude: ['rows', 'cents', 'cus_'],
      maxSentences: 10,
    },
  },
  {
    name: 'ltv — proactive widening in one turn when default returns null',
    // This case validates two valid answer shapes for "give me an LTV even if
    // 30d is narrow":
    //   (a) Default 30d returned null → LLM widens proactively (mentions wider
    //       window / divergence / cannot compute).
    //   (b) Default 30d returned a number BUT low_sample / small-base → LLM
    //       hedges directionally without needing to widen.
    // The fixture has 4 active subs + 1 churned (25% churn → real LTV), so the
    // dominant fixture path is (b). Production validation on Merchant A will
    // exercise path (a) (zero observed churn in 30d → wider window suggested).
    question: "Give me an estimate of customer LTV even if Stripe's 30-day window is too narrow.",
    // expectTools omitted — LLM may make 1 or 2 calls; either is fine
    expectAnswer: {
      // Accept either (a) wider-window framing OR (b) low-sample-hedge framing.
      mustMatch: [/(wider|90.?day|365.?day|year|diverge|differs|broader|longer|deeper|smoother|cannot|can't|unable|no.*churn|haven't|hasn't|no observed|insufficient|low.?sample|small.*base|directional|approximat|grain.*of.*salt|small.*subscriber|few.*subscriber)/i],
      mustNotMatch: [/(can't access|isn't available|integration|broken|fabricat)/i],
      mustNotInclude: ['array', 'cents'],
      maxSentences: 10,
    },
  },
  {
    name: 'ltv — scope clarity (subscriber LTV vs all-customer revenue)',
    question: 'How valuable is my average customer?',
    // expectTools omitted — LLM may pick ltv, customer_spend_distribution,
    // arpu, or any combination. Open-ended question.
    expectAnswer: {
      // Must signal subscription/MRR scope OR surface the direct-charge
      // distinction (Path Z scope-flag pattern carry-forward from 2E).
      mustMatch: [/(subscription|recurring|subscriber|direct|charge|one.?off|per.?customer)/i],
      mustNotInclude: ['cus_', 'sub_', 'cents'],
      maxSentences: 12,
    },
  },
];
