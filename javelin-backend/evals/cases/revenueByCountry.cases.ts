import type { EvalCase } from '../assertions';

// revenue_by_country — calibrated to FIXTURE:
//   February 2026: CA/cad CA$300 (1 charge), GB/gbp £120 (1 charge)
//
// February 2026 was chosen as the test window because it's empty in the
// existing fixture, so adding multi-currency charges there doesn't
// contaminate currency-grouping primitives like periodCollectedRevenue.
// (March/April still single-currency USD; Q1 composite absorbs the extra
// rows but its assertions still hold.)

export const REVENUE_BY_COUNTRY_CASES: EvalCase[] = [
  {
    name: 'revenue_by_country — February 2026 multi-currency breakdown',
    question: 'Show me revenue by country in February 2026.',
    expectTools: [
      {
        name: 'revenue_by_country',
        argsExact: { start: '2026-02-01', end: '2026-02-28' },
      },
    ],
    expectAnswer: {
      // Country attribution must surface — accept either ISO alpha-2 or
      // the natural-language country name. LLM tends toward natural forms
      // ("Canada", "UK"); user preference was ISO codes, but we don't
      // make that mandatory in the assertion (production validation
      // surfaces voice). The currency prefix CA$ already contains "CA",
      // so that one passes either way.
      mustMatch: [
        /CA\$300/,                                       // CAD format
        /£120/,                                          // GBP symbol-only
        /(GB|UK|U\.K\.|United Kingdom|Britain)/i,        // GB country attribution
      ],
      mustNotMatch: [
        /CAD \$300/,                  // doubled (broken FORMAT pattern)
        /CAD 300/,                    // code without symbol (broken pattern)
        /GBP \$?120/,                 // GBP code (correct is bare £)
      ],
      // Asterisk allowed — multi-currency country list uses bullets per
      // system prompt (Type B fix 2026-05-07).
      mustNotInclude: ['cents'],
      maxSentences: 5,
    },
  },
  {
    name: 'revenue_by_country — empty period (no charges in January 2026)',
    question: 'Show me revenue by country in January 2026.',
    expectTools: [
      {
        name: 'revenue_by_country',
        argsExact: { start: '2026-01-01', end: '2026-01-31' },
      },
    ],
    expectAnswer: {
      // Empty-period convention: no count assertions, just the empty-fact
      // framing per FORMAT rule "When a tool returns empty rows, describe
      // the business reality in plain English".
      mustMatch: [/(no|nothing|quiet|empty|didn't)/i],
      // Asterisk allowed — empty-period framing may use bold for emphasis
      // (Type B fix 2026-05-07).
      mustNotInclude: ['rows', 'array', 'records'],
      maxSentences: 5,
    },
  },
  // ── Phase 2C — series mode ──────────────────────────────────────────────
  // FIXTURE recap for series cases: Feb 2026 has CA$300 CAD/CA + £120 GBP/GB.
  // March/April are USD-only (US country). Q1 2026 monthly buckets are
  // [Jan, Feb, Mar] — Jan empty, Feb multi-currency, Mar USD-only.
  {
    name: 'revenue_by_country — series, monthly Q1 2026 multi-currency',
    question: 'Show me revenue by country month over month for Q1 2026.',
    expectAnswer: {
      // CAD CA$300 (Feb) and GBP £120 (Feb) are the calibrated multi-currency
      // anchors; USD March amounts also expected (~$3,700 collected total).
      mustMatch: [
        /CA\$300/,
        /£120/,
      ],
      mustNotMatch: [
        /CAD \$300/,                  // doubled (broken FORMAT pattern)
        /GBP \$?120/,                 // GBP code (correct is bare £)
      ],
      mustNotInclude: ['cents', 'cus_', 'ch_', 'bucket'],
      maxSentences: 12,
    },
  },
  {
    name: 'revenue_by_country — series, country attribution disclosed when relevant',
    question: 'Where is my revenue coming from geographically over the last three months?',
    expectAnswer: {
      // Sonnet should mention the card-issuing-country attribution per the
      // Q5 documentation lock 2026-05-09 (tool description teaches this).
      // Loose match — accept any phrasing that signals the proxy nature.
      mustMatch: [
        /(card[- ]?issuing|BIN|issuing country|card[- ]?country)/i,
      ],
      mustNotInclude: ['cents', 'cus_', 'ch_'],
      maxSentences: 12,
    },
  },
];
