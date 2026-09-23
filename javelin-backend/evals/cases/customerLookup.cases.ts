import type { EvalCase } from '../assertions';

// customer_lookup — calibrated to FIXTURE_CUSTOMERS extension (Chunk C / 2B):
//   cus_jenny_rosen — name 'Jenny Rosen', email 'jenny@example.com',
//                     1 charge ch_jr_1 (apr_28, $245). Most-recent-active.
//   cus_jenny_smith — name 'Jenny Smith', email 'jenny.smith@example.com',
//                     1 charge ch_js_1 (feb_15, $100). Older.
//
// Stripe Search exact match returns 0 for "Jenny" → primitive falls back
// to prefix-match across customer list, finds both. Disambiguation sort
// (Q9.1) puts Jenny Rosen first.

export const CUSTOMER_LOOKUP_CASES: EvalCase[] = [
  {
    name: 'customer_lookup — exact name match',
    question: 'Look up Jenny Rosen.',
    expectTools: [
      { name: 'customer_lookup', argsExact: { name: 'Jenny Rosen' } },
    ],
    expectAnswer: {
      mustMatch: [
        /jenny rosen/i,
        /(jenny@example\.com|\$245)/i, // surfaces email or last-payment amount
      ],
      // Asterisk allowed — LLM may bold the customer name (Type B fix 2026-05-07).
      mustNotInclude: ['cus_'],
      maxSentences: 4,
    },
  },
  {
    name: 'customer_lookup — name disambiguation (multiple Jennys)',
    question: 'Look up Jenny.',
    expectTools: [{ name: 'customer_lookup', argsExact: { name: 'Jenny' } }],
    expectAnswer: {
      // Most-recent-active Jenny (Rosen) surfaced first; alternatives
      // disclosed somewhere in the answer ("there are 2 others", "another
      // Jenny", "Jenny Smith", etc.).
      mustMatch: [
        /jenny rosen/i,
        /(jenny smith|other|alternat|another|2 jennys|two jennys)/i,
      ],
      // Asterisk allowed — LLM may bold the customer name (Type B fix 2026-05-07).
      mustNotInclude: ['cus_'],
      maxSentences: 5,
    },
  },
  {
    name: 'customer_lookup — email lookup',
    question: 'Find the customer with email jenny@example.com.',
    expectTools: [
      {
        name: 'customer_lookup',
        argsExact: { email: 'jenny@example.com' },
      },
    ],
    expectAnswer: {
      mustMatch: [/jenny rosen/i],
      // Asterisk allowed — LLM may bold the customer name (Type B fix 2026-05-07).
      mustNotInclude: ['cus_'],
      maxSentences: 4,
    },
  },
  {
    // Hot-fix coverage (2026-05-01) — Joy Rowe pattern: customer's
    // identifying name lives in `description`, not `name`. Pre-hot-fix
    // search returned 0; post-hot-fix should find via the multi-field
    // search path AND surface "Joy Rowe" through the extended display_name
    // fallback chain (description-tier).
    name: 'customer_lookup — description-only-named customer',
    question: 'Look up Joy Rowe.',
    expectTools: [
      { name: 'customer_lookup', argsExact: { name: 'Joy Rowe' } },
    ],
    expectAnswer: {
      mustMatch: [/joy rowe/i],
      mustNotMatch: [
        // Guard against the LLM saying "no customer found" — pre-hot-fix
        // failure mode.
        /(no customer.*found|couldn'?t find|no.*match)/i,
      ],
      // Asterisk allowed — LLM may bold the customer name (Type B fix 2026-05-07).
      mustNotInclude: ['cus_'],
      maxSentences: 4,
    },
  },
];
