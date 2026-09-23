import type { EvalCase } from '../assertions';

// mrr_movement — Phase 2D coverage.
//
// Eval philosophy: existing FIXTURE_INVOICES are not subscription-linked
// (no `invoice.subscription` field), so the synthesis layer can't reconstruct
// active subs and Pass-1 (new) / Pass-3 (expansion/contraction) emit nothing
// on the eval fixture. Pass-2 (churn) DOES fire post-2026-05-14 fix
// (commit f60e182, project_javelin_mrr_movement_bug_class): the 6 March-ended
// canceled stub subs hit the new sub-items fallback and produce -$600 in
// churn (6 × $100/mo, all using CANCELED_STUB_ITEM monthly pricing). The
// primitive's bucket-classification logic is validated precisely in
// `lib/metrics/mrrMovement.test.ts` (31 surgical unit tests). These eval
// cases validate LLM BEHAVIOR on top of that:
//   - Correct tool selection for MRR-change questions
//   - Correct churn narration when sub-items fallback fires (no invoice path)
//   - Flow/state distinction (Q6 guards) when mrr + mrr_movement both called
//   - No improper numerical combination of state and flow metrics
//   - No false claims of new/expansion when only churn fired
//
// Draft eval cases for trial-to-paid + annual-churn isolated detection live
// in `mrrMovement.cases.draft.ts`; applying them requires fixture additions
// and a calibration sitting with a live eval run.

export const MRR_MOVEMENT_CASES: EvalCase[] = [
  {
    name: 'mrr_movement — March churn narration (6 cancellations, $600 lost via sub-items fallback)',
    question: 'How has my MRR changed in March 2026?',
    expectTools: [
      {
        name: 'mrr_movement',
        argsExact: { start: '2026-03-01', end: '2026-03-31' },
      },
    ],
    expectAnswer: {
      // Post-fix: 6 canceled stub subs ($100/mo each, monthly interval)
      // hit Pass-2 sub-items fallback → -$600 in churn. LLM should surface
      // either the dollar amount or the cancellation count (or both) and
      // narrate the business fact (cancellations / churn), not the data shape.
      mustMatch: [/\$600|six|\b6\s*(sub|cancel|churn)|cancellation/i],
      mustNotInclude: ['rows', 'array', 'events array', 'cus_', 'sub_'],
      mustNotMatch: [
        /(can't access|isn't available|integration|scope|sigma)/i,
        // Pre-fix the empty result allowed "no movement" framing. Post-fix
        // there IS movement (churn), so reject those phrases.
        /(no MRR movement|nothing chang|flat MRR|stable MRR|didn't change)/i,
        // Only churn fired — must not invent new/expansion/contraction.
        /\bnew subscription|\bexpansion\b|\bupgrad/i,
      ],
      maxSentences: 6,
    },
  },
  {
    name: 'mrr_movement — flow/state distinction (Q6 guard, both tools called)',
    // Tests Q6 Layer 3 — when a question naturally invites combining state
    // and flow, the LLM must call both tools and narrate them SEPARATELY
    // without arithmetic combination. Post-fix the flow now carries real
    // churn signal (-$600 March), making the Q6 discipline more load-bearing
    // than when flow was empty.
    question: "What's my current MRR and how has it changed lately?",
    // expectTools omitted — LLM may use any reasonable date window for
    // "lately"; both `mrr` and `mrr_movement` should appear in tool calls.
    expectAnswer: {
      // Must surface CURRENT MRR (state). Fixture is $1,400 USD MRR.
      mustMatch: [/\$1,400/],
      mustNotInclude: ['cus_', 'sub_', 'cents'],
      // Q6 guard — must NOT combine state and flow numerically. Reject
      // phrases that suggest subtracting/adding mrr_movement output to mrr.
      mustNotMatch: [
        // "$1,400 minus $X movement = $Y" or similar arithmetic
        /\$1,400\s*[-−]\s*\$/,
        /\$1,400\s*\+\s*\$/,
      ],
      maxSentences: 8,
    },
  },
  {
    name: 'mrr_movement — quarter window works ($600 lost in Q1, F1 indefinite-window advantage)',
    // Validates that F1 has no 30-day cap. Q1 2026 is a 3-month window
    // (longer than Stripe Events API retention), and mrr_movement
    // accepts and processes it without error. Post-fix Q1 includes
    // March's -$600 churn (the only movement on the fixture).
    // expectTools relaxed 2026-05-13 (Phase 2F) — "what drove" naturally
    // invites the LLM to also call growth_attribution (the cross-pointer
    // behavior we explicitly designed for in Phase 2E). Tool-selection
    // strictness here would punish the very behavior we want.
    question: 'What drove my MRR changes in Q1 2026?',
    expectAnswer: {
      // Post-fix: Q1 has -$600 churn concentrated in March.
      mustMatch: [/\$600|six|\b6\s*(sub|cancel|churn)|cancellation|churn/i],
      mustNotInclude: ['rows', 'array', 'cents', 'cus_', 'sub_'],
      // 30[\s-]?day removed 2026-05-13 (Phase 2F) — too aggressive. Was
      // meant to catch Stripe-API-implementation-leakage ("events have a
      // 30-day retention window") but also caught benign mentions like
      // "the 30-day rolling window I looked at." Keep the other guards
      // for actual technical-shape leakage.
      mustNotMatch: [
        /(can't access|isn't available|event retention|sigma)/i,
        /(no MRR movement|nothing chang|flat MRR|stable MRR)/i,
      ],
      maxSentences: 6,
    },
  },
];
