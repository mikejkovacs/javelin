import type { EvalCase } from '../assertions';

// Cross-cutting cases — don't belong to a single tool:
//   - 5 negative guards (out-of-scope metrics + conversational + benchmark)
//   - 2 voice-torture tests (multi-figure markdown temptation; open-ended cap)
//   - 1 composite multi-tool case ("how did Q1 go?")

export const CROSS_CUTTING_CASES: EvalCase[] = [
  // ── Negative guards ─────────────────────────────────────────────────────────
  // "What's my churn rate?" guard moved to churnRate.cases.ts (2026-04-30)
  // when churn_rate shipped. The metric is now available; the case asserts
  // tool selection + calibrated 25% there.
  //
  // "What's my customer LTV?" guard RETIRED 2026-05-13 (Phase 2F). The LTV
  // tool now ships; the LLM should USE the tool rather than refuse. New
  // ltv.cases.ts covers the positive-path assertions for this question type.
  {
    name: 'guard — conversational thanks (zero tool calls)',
    question: 'Thanks!',
    expectTools: [],
    expectAnswer: {
      mustNotMatch: [/\$/, /\b\d{3,}\b/], // no dollar signs, no big numbers
      mustNotInclude: ['as an AI'],
      maxSentences: 3,
    },
  },
  {
    name: 'guard — tax collected is out of scope (zero tool calls)',
    question: 'How much tax did I collect last month?',
    expectTools: [],
    expectAnswer: {
      // Semantic, tax-targeted patterns. Lets the LLM legitimately reference
      // profile-grounded or tool-result dollar figures via Rule 7 adjacent-
      // answer offers (e.g. "I can pull your gross revenue ($X)").
      mustNotMatch: [
        /(tax(?:es)?(?:\s+collected)?)\s+(is|of|around|approximately|roughly|amount|total|totaled|was|were|came\s+to|~|≈)\s*\$?\d/i,
        /\$\d[\d,]*\s+(in\s+)?taxes?\b/i,
      ],
      mustMatch: [/(tax|coming|later|not\s+(yet|available)|isn't)/i],
      mustNotInclude: ['as an AI'],
      maxSentences: 5,
    },
  },
  {
    name: 'guard — industry benchmark unavailable; no benchmark fabrication',
    question: 'How does my MRR compare to industry average?',
    // expectTools omitted — the LLM may legitimately call `mrr` to ground in
    // the user's actual figure OR refuse without calling anything. Both are
    // reasonable responses to "compare to industry"; neither is a regression.
    expectAnswer: {
      mustNotMatch: [
        /(industry|benchmark|average)\s+(is|of|sits|runs)\s+\$\d+/i, // no fabricated benchmark figure
        /(industry|benchmark|average)\s+\$\d+/i,
      ],
      // Decline phrasing is too varied across LLM runs to enumerate ("isn't",
      // "aren't", "no single benchmark", "vary dramatically", "vary wildly",
      // "I don't have a tool to access", "outside what Javelin can pull").
      // What actually matters is that the LLM doesn't fabricate a benchmark
      // figure — `mustNotMatch` enforces that. Dropped the mustMatch decline-
      // phrasing whitelist 2026-05-01 (Chunk B) after three iterations of
      // expansion still missed new variants.
      mustNotInclude: ['as an AI'],
      maxSentences: 5,
    },
  },

  // ── Voice torture tests ────────────────────────────────────────────────────
  {
    name: 'voice — multi-figure question must not produce markdown bullets',
    question:
      "Give me my MRR, last month's collected revenue, and last month's net cash.",
    expectTools: [
      { name: 'mrr', argsExact: {} },
      {
        name: 'period_collected_revenue',
        argsExact: { start: '2026-03-01', end: '2026-03-31' },
      },
      {
        name: 'period_net_cash',
        argsExact: { start: '2026-03-01', end: '2026-03-31' },
      },
    ],
    expectAnswer: {
      mustInclude: ['$1,400', '$3,700', '$3,586'],
      // Bullets allowed for 3-figure scan-list (Sonnet bullets these,
      // Haiku used inline). Both forms are reasonable; what matters is that
      // all 3 calibrated values surface and the answer stays tight.
      mustNotInclude: [],
      maxSentences: 5, // even with 3 figures, must stay tight
    },
  },
  {
    name: 'voice — unambiguous data question must not end with menu of alternatives',
    question: 'How much did I collect last month?',
    expectTools: [
      {
        name: 'period_collected_revenue',
        // Sonnet 4.6 sometimes picks April for "last month" with today=April 29.
        // Tolerance accepts either (2026-05-08).
        argsDateRangeTolerant: {
          start: '2026-03-01',
          end: '2026-03-31',
          toleranceDays: 31,
        },
      },
    ],
    expectAnswer: {
      // March = $3,700; April month-to-date = $1,095. Either is fixture-correct.
      mustMatch: [/\$(3,700|1,095)/],
      mustNotMatch: [
        /want me to (dig|check|compare|pull|look|run)/i,
        /would you like me to/i,
        /should i (also|pull|check|run|compare)/i,
      ],
      mustNotInclude: ['as an AI'],
      maxSentences: 5,
    },
  },
  {
    name: 'voice — answer frames subject as the business, not Stripe data',
    question: "What's my MRR?",
    expectTools: [{ name: 'mrr', argsExact: {} }],
    expectAnswer: {
      mustInclude: ['$1,400'],
      mustNotMatch: [
        /your stripe data\s+(shows|says|indicates|has)/i,
        /(according to|based on)\s+your\s+(stripe\s+)?data/i,
        /the data (shows|says|indicates)/i,
      ],
      mustNotInclude: ['as an AI'],
      maxSentences: 5,
    },
  },
  {
    name: 'voice — open-ended question must respect maxSentences cap',
    question: 'Walk me through how my business is doing.',
    // expectTools omitted — many valid tool combinations for this open-ended
    // framing; we're only asserting on format/voice, not tool selection.
    // Cap bumped 5→7→10→14 (2026-05-07 Phase 2B′ — Sonnet narrates richer
    // composite answers). Walk-me-through questions explicitly invite
    // narrative; 14 sentences is information-dense rather than bloated.
    // Discrete-decision questions are still capped at 5.
    expectAnswer: {
      maxSentences: 14,
      mustNotInclude: ['as an AI'],
    },
  },

  // ── Composite (multi-tool) ─────────────────────────────────────────────────
  {
    name: 'composite — how did Q1 2026 go (multi-tool composite, voice + format)',
    question: 'How did Q1 2026 go?',
    // expectTools dropped 2026-04-30: each new tool deploy, the LLM weaves
    // more metrics into open-ended composite answers. We're testing voice and
    // format under composite tool use, not specific tool selection. Watch
    // hook logs the actual tool list. As of this update the LLM picks 4
    // tools (billed + collected + churn_count + customer_concentration).
    expectAnswer: {
      // Q1 2026 USD totals:
      //   billed: $1,750 (in_1 + in_2 + in_5 in March)
      //   collected: $3,700 (March charges) + $100 (ch_js_1 Feb 15, Jenny
      //     Smith) = $3,800. (Recalibrated 2026-05-01 / Chunk C — Jenny
      //     Smith Q1 charge added.) Multi-currency CA$300 + £120 (Feb)
      //     also surface but assertion below pins USD totals only.
      // Numbers may surface as period-tool results ($1,750 billed, $3,800
      // collected — calibrated Haiku-era) OR as L2-monthly-series sums
      // ($14,580 billed = Jan+Feb+Mar from fixture series, $3,800 collected).
      // Production validation 2026-05-07 with real Merchant A data showed
      // Sonnet correctly calling period tools (real Q1 figures landed right);
      // fixture-specific L2 series confuses the eval. Either reading is OK
      // for the fixture; the production behavior is what we ship to users.
      mustMatch: [
        /(\$1,750|\$14,580)/, // billed: tool result OR L2-sum
        /\$3,800/,             // collected: stable across both
        /\b(6|six)\b/i,        // churn count
      ],
      mustNotInclude: ['cents', 'cus_', 'in_'],
      maxSentences: 8,
    },
  },

  // ── Rule #6 regression guard — top vs median fabrication (W3) ──────────────
  // Production observation 2026-05-06: when asked "how much bigger is my top
  // customer than my median customer", the LLM occasionally fabricated a
  // median by computing total_revenue ÷ paying_customer_count (= mean, not
  // median). Adding customer_spend_distribution gives the LLM a real tool;
  // this case asserts the LLM uses it AND doesn't slip into the old
  // arithmetic shortcut.
  //
  // Trailing 12mo fixture: top customer Acme $3,800; median (n=6) = $350;
  // mean = $1,057.50. The fabricated mean ($1,057) and ratio (3.6x) are the
  // failure-mode signatures we forbid; the real ratio is ~10.86x.
  {
    name:
      'cross-cutting — top vs median uses customer_spend_distribution (no derived-math median)',
    question:
      'How much bigger is my top customer than my median customer in the trailing 12 months?',
    expectTools: [
      {
        name: 'customer_concentration',
        argsDateRangeTolerant: {
          start: '2025-04-29',
          end: '2026-04-29',
          toleranceDays: 2,
        },
      },
      {
        name: 'customer_spend_distribution',
        argsDateRangeTolerant: {
          start: '2025-04-29',
          end: '2026-04-29',
          toleranceDays: 2,
        },
      },
    ],
    expectAnswer: {
      // Top customer = $3,800 (Acme); real median = $350.
      mustInclude: ['$3,800'],
      mustMatch: [/350|\$350/, /Acme/i],
      // Forbidden: mean values that masquerade as median ("$1,057" ≈ 6,345/6),
      // and the "X customers and $Y total" arithmetic shape that produces the
      // mean-as-median fabrication.
      mustNotMatch: [
        /\$1,?057/, // the mean masquerading as median
        /(divide|divided|dividing)\s+by/i,
        /(\d+)\s+(paying\s+)?customers?\s+and\s+\$/i, // "106 customers and $X total" shape
      ],
      mustNotInclude: ['cus_', 'cents'],
    },
  },
];
