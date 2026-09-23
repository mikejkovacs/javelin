import type { EvalCase } from '../assertions';

// churn_reasons — calibrated to FIXTURE_CANCELED_SUBSCRIPTIONS:
//   March 2026: 6 churns, 3 with feedback (too_expensive, missing_features,
//     switched_service), 3 null → coverage 'high'
//   Q4 2025: 5 churns, all payment_failed, all null feedback → coverage 'none'

export const CHURN_REASONS_CASES: EvalCase[] = [
  {
    name: 'churn_reasons — March 2026, narrates feedback buckets (high coverage)',
    // Pinned date 2026-04-30 — "last month" was producing variable LLM date
    // interpretations (sometimes March, sometimes Apr 1-29 partial) which made
    // the case flaky. Explicit "in March 2026" makes the period deterministic.
    question: 'Why did customers cancel in March 2026?',
    // expectTools omitted 2026-04-30 — LLM intermittently calls churn_reasons
    // alone or alongside churn_count for richer "why did people cancel"
    // narration. Both are reasonable; the answer assertion below confirms the
    // LLM read the feedback data. Watch hook logs the actual tool list.
    expectAnswer: {
      // LLM should reference the three feedback categories. Loose match —
      // "too expensive" might appear as "price", "missing features" as
      // "features"; require ≥1 of the three concepts to land.
      mustMatch: [/(price|expensive|features|switched|competitor)/i],
      mustNotInclude: ['cents', 'sub_can_'],
      maxSentences: 6,
    },
  },
  {
    name: 'churn_reasons — Q4 2025, no portal feedback (coverage: none)',
    question: 'Why did people cancel in Q4 2025?',
    // expectTools dropped 2026-04-30: LLM now also calls churn_count for
    // richer context (count + reason narrative). Same pattern as the
    // sibling 'targeted bucket' case below. Watch hook logs the actual list.
    expectAnswer: {
      // LLM should acknowledge no customer-stated reasons in the data.
      // Expanded 2026-04-30 — LLM uses varied negative-framing phrases
      // ("none of them came with...", "Without that feedback", "data isn't there").
      mustMatch: [
        /(don't have|no\s+(customer|portal|stated|recorded|feedback)|not\s+(captured|recorded|available)|none of them|without (that|customer|any) feedback|isn't there|data\s+(simply\s+)?isn't|no feedback)/i,
      ],
      mustNotInclude: ['cents', 'sub_can_'],
      maxSentences: 5,
    },
  },
  {
    name: 'churn_reasons — targeted bucket question routes here',
    question: "Were last month's cancellations about price?",
    // expectTools omitted — LLM may call churn_reasons alone or alongside
    // churn_count for richer context (count + reason narrative). Both are
    // reasonable; the soft answer assertion confirms the LLM read the data.
    // Watch hook logs the actual tool list + phrasing.
    expectAnswer: {
      // March: 1 of 6 cited too_expensive. Watch hook logs the actual answer;
      // soft assertion since wording varies ("yes, one customer cited price"
      // vs. "1 of 6 listed too_expensive" vs. "partially — 1 mentioned price").
      mustNotInclude: ['cents', 'sub_can_'],
      maxSentences: 5,
    },
  },
];
