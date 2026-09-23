import type { EvalCase } from '../assertions';

// churn_rate — Stripe-canonical rolling 30-day. Calibrated against fixture at
// FROZEN_NOW = 2026-04-29:
//   churned_30d = 1 (cus_foxtrot, sub ended exactly at T-30d boundary)
//   active_30d_ago = 4
//   new_30d = 0
//   value = 1 / (4 + 0) = 0.25 = 25%

export const CHURN_RATE_CASES: EvalCase[] = [
  {
    name: 'churn_rate — rolling 30-day, calibrated 25%',
    question: "What's my churn rate?",
    expectTools: [{ name: 'churn_rate', argsExact: {} }],
    expectAnswer: {
      mustMatch: [/\b(25|twenty.?five)\s*%/i],
      mustNotMatch: [
        // Anti-confabulation: don't claim a non-canonical "monthly" or "March"
        // churn rate computed from arbitrary data.
        /\b(?:march|february|april|january)\s+churn\s+rate/i,
      ],
      mustNotInclude: ['cents', 'cus_'],
      maxSentences: 5,
    },
  },
];
