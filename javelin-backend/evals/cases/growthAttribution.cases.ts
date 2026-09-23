import type { EvalCase } from '../assertions';

// growth_attribution — Phase 2E coverage.
//
// Same philosophy as mrr_movement: FIXTURE_INVOICES are not subscription-
// linked, so growth_attribution returns empty rows on the fixture. The
// primitive's per-plan aggregation logic is validated precisely in
// `lib/metrics/growthAttribution.test.ts` (14 surgical unit tests covering
// envelope flags, sort order, multi-currency, top-20 cap with "Other"
// rollup, reconciliation, pct_of_net_growth edge cases).
//
// These eval cases instead validate LLM BEHAVIOR:
//   - Tool selection on growth-attribution questions
//   - Empty-period business-framed narration (WHEN DATA rule)
//   - Scope clarity — answer signals subscription/MRR scope, doesn't
//     conflate with one-off-charge revenue
//   - Composition with mrr_movement — composite questions may call both
//
// Production validation on Merchant A (post-deploy) is the integration
// test against real Stripe data.

export const GROWTH_ATTRIBUTION_CASES: EvalCase[] = [
  {
    name: 'growth_attribution — tool selection on "where is growth coming from"',
    question: 'Where is my MRR growth coming from in Q1 2026?',
    expectTools: [
      {
        name: 'growth_attribution',
        argsExact: { start: '2026-01-01', end: '2026-03-31' },
      },
    ],
    expectAnswer: {
      // No movement events on the fixture → empty-period framing per WHEN
      // DATA rule ("narrate the business fact, not the data shape").
      mustMatch: [/(no|nothing|didn't|did not|flat|stable|quiet|haven't)/i],
      mustNotInclude: ['rows', 'array', 'cents', 'cus_', 'sub_'],
      mustNotMatch: [/(can't access|isn't available|integration|scope error)/i],
      maxSentences: 6,
    },
  },
  {
    name: 'growth_attribution — empty-period narration (plans-only question)',
    question: 'Which plans drove MRR growth in March 2026?',
    expectTools: [
      {
        name: 'growth_attribution',
        argsExact: { start: '2026-03-01', end: '2026-03-31' },
      },
    ],
    expectAnswer: {
      mustMatch: [/(no|flat|stable|nothing|haven't|didn't|did not)/i],
      mustNotMatch: [/(can't access|isn't available|integration|scope error)/i],
      mustNotInclude: ['rows', 'truncated', 'array'],
      maxSentences: 6,
    },
  },
  {
    name: 'growth_attribution — scope clarity (subscription MRR vs all revenue)',
    // The envelope returns scope: 'subscription_mrr'. The tool description
    // says "Stripe subscription billing only — does NOT include one-off
    // charges". When asked an open-ended growth question, the LLM may
    // either call growth_attribution OR mrr_movement OR both — the
    // assertion is on answer CONTENT: the scope signal should land.
    question: 'What is driving my growth this quarter?',
    // expectTools omitted — open-ended question; LLM picks freely.
    expectAnswer: {
      // Must surface subscription/MRR vocabulary so the user understands
      // the scope (this excludes one-off charges).
      mustMatch: [/(subscription|recurring|MRR)/i],
      mustNotInclude: ['cus_', 'sub_', 'cents', 'rows', 'array'],
      mustNotMatch: [/(can't access|isn't available)/i],
      maxSentences: 8,
    },
  },
  {
    name: 'growth_attribution — composition with mrr_movement on combined question',
    // Composite question — what changed + where from. LLM may legitimately
    // call mrr_movement, growth_attribution, or both. Per the working-mode
    // acceleration-lever convention for open-ended composites, drop
    // expectTools and assert on answer content only.
    question: 'How did my MRR change in Q1 and where did the changes come from?',
    expectAnswer: {
      mustMatch: [/(no|flat|quiet|nothing|stable|haven't|didn't|did not)/i],
      mustNotMatch: [/(can't access|isn't available)/i],
      mustNotInclude: ['rows', 'cents', 'cus_', 'sub_', 'array'],
      maxSentences: 8,
    },
  },
];
