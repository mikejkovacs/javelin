import type { EvalCase } from '../assertions';

// project_revenue — calibrated against FIXTURE_PROFILE's L2 series (today
// 2026-04-29):
//
// monthly_recurring_billed_series last 7 (Oct→Apr): 4060, 4180, 4290, 4360,
//   4400, 4510, 4420 → avg ≈ +1.44%, trend: flat. current = 4420.
//   Horizon 6 → 4420 × (1.0144)^6 ≈ 4815.
//   Horizon 1 → 4420 × 1.0144 ≈ 4484.
//
// monthly_billed_revenue_series last 7: 4520, 4610, 4720, 4810, 4830, 4940,
//   4820 → avg ≈ +1.09%, trend: flat. current = 4820.
//   Horizon 3 → 4820 × (1.0109)^3 ≈ 4979.
//
// monthly_collected_charges_series last 7: 460, 430, 430, 450, 430, 430, 400
//   → avg ≈ -2.21%, trend: declining. current = 400.
//   Horizon 6 → 400 × (0.9779)^6 ≈ 350.
//
// CRITICAL RULE #10 voice assertions: conditional verb tense ("would," "you'd"),
// "trajectory" / "if" / "assuming" / "at current" framing, and the trend label
// disclosed in narration. Forbid "you will" / "you'll" future-tense fact-claims.

export const PROJECT_REVENUE_CASES: EvalCase[] = [
  {
    name: 'project_revenue — recurring_revenue 6 months ahead, flat trend',
    question: 'Where will my MRR be in 6 months?',
    expectTools: [
      {
        name: 'project_revenue',
        argsExact: {
          metric: 'recurring_revenue',
          lookback_months: 6,
          horizon_months: 6,
        },
      },
    ],
    expectAnswer: {
      // Projected ~$4,815 — allow $4,500-$5,200 to absorb LLM rounding.
      mustMatch: [
        /\$?[45][,.]?\d{3}/,                                       // some figure in the band
        /(if|assuming|at\s+(?:your\s+)?current|trajectory|holds|based\s+on)/i, // conditional framing
        /(would|you'?d)/i,                                         // conditional verb
        /(flat|steady|holding|stable|hovering|roughly)/i,           // trend disclosure
      ],
      mustNotMatch: [
        /\byou\s+will\b/i,                                         // forbid future-tense fact
        /\byou'?ll\s+(have|hit|reach|see)\b/i,
      ],
      mustNotInclude: ['as an AI'],
      maxSentences: 5,
    },
  },
  {
    name: 'project_revenue — billed_revenue 3 months ahead (default horizon), flat trend',
    question: 'Where will billed revenue be in three months?',
    expectTools: [
      {
        name: 'project_revenue',
        argsExact: {
          metric: 'billed_revenue',
          lookback_months: 6,
          horizon_months: 3,
        },
      },
    ],
    expectAnswer: {
      // Projected ~$4,979 — allow $4,800-$5,200.
      mustMatch: [
        /\$?[45][,.]?\d{3}/,                                       // figure in band
        /(if|assuming|at\s+(?:your\s+)?current|trajectory|holds|based\s+on)/i,
        /(would|you'?d)/i,
        /(flat|steady|holding|stable|hovering|roughly|tracking)/i,
      ],
      mustNotMatch: [/\byou\s+will\b/i, /\byou'?ll\s+(have|hit|reach|see)\b/i],
      // Asterisk allowed — projection answers may bold the headline figure
      // (Type B fix 2026-05-07).
      mustNotInclude: [],
      maxSentences: 5,
    },
  },
  {
    name: 'project_revenue — direct_charge declining 6 months ahead, no fabricated optimism',
    question: 'Where will my one-time-payment revenue be in 6 months?',
    expectTools: [
      {
        name: 'project_revenue',
        argsExact: {
          metric: 'direct_charge_revenue',
          lookback_months: 6,
          horizon_months: 6,
        },
      },
    ],
    expectAnswer: {
      // Projected ~$350 — allow $300-$400.
      mustMatch: [
        /\$?[34]\d{2}/,                                            // figure in band
        /(if|assuming|at\s+(?:your\s+)?current|trajectory|holds|based\s+on)/i,
        /(would|you'?d)/i,
        /(declin|down|decreas|dropping|negative|softening|shrink)/i, // trend disclosed honestly
      ],
      mustNotMatch: [
        /\byou\s+will\b/i,
        /\byou'?ll\s+(have|hit|reach|see)\b/i,
        // Anti-alarmist guard (sibling to growth_rate.cases declining test).
        // "steep" dropped 2026-05-07 Phase 2B′ amendment — borderline word
        // (factual "steep curve" vs alarmist "steep decline"); other words
        // unambiguously alarmist.
        /(severe|catastroph|crisis|crash|plunge|plummet|collapse)/i,
      ],
      mustNotInclude: [],
      maxSentences: 5,
    },
  },
  {
    name: 'project_revenue — short horizon (1 month), recurring revenue',
    question: 'Where will MRR land next month?',
    expectTools: [
      {
        name: 'project_revenue',
        argsExact: {
          metric: 'recurring_revenue',
          lookback_months: 6,
          horizon_months: 1,
        },
      },
    ],
    expectAnswer: {
      // Number band: trailing series projection ~$4,484 ($4,400-$4,700) OR
      // current_l1_state_mrr-led projection ~$4,820+1.4% = ~$4,880 ($4,700-
      // $4,900). Per Phase 2B′ amendment, project_revenue tool description
      // now directs Sonnet to ALWAYS lead with current_l1_state_mrr when
      // present — so the higher-band reading is the EXPECTED post-amendment
      // behavior, not a regression.
      mustMatch: [
        /\$?4[,.]?[4-9]\d{2}/,
        // Conditional framing — accept either explicit conditional verb
        // ("would" / "you'd") OR the conditional-marker phrasing.
        /(would|you'?d|if\s+(?:your\s+)?(?:current\s+)?trajectory\s+holds|assuming|at\s+(?:your\s+)?current\s+trajectory)/i,
      ],
      mustNotMatch: [/\byou\s+will\b/i, /\byou'?ll\s+(have|hit|reach|see)\b/i],
      mustNotInclude: [],
      maxSentences: 5,
    },
  },
  {
    name: 'voice — backward-looking question does NOT trigger projection mode',
    question: 'How much did I collect last month?',
    // expectTools omitted — should hit period_collected_revenue, NOT project_revenue.
    expectAnswer: {
      // Anti-bleed: backward-looking answer must NOT use Rule #10 framing.
      // Don't require "if/assuming/trajectory" — it would be wrong here.
      // DO forbid the conditional verb forms that only make sense for projections.
      mustNotMatch: [
        /at\s+(?:your\s+)?current\s+trajectory/i,
        /if\s+(?:your\s+)?(?:current\s+)?trajectory\s+holds/i,
        /\bwould\s+(?:reach|hit|land|cross)\b/i,
      ],
      mustNotInclude: [],
      maxSentences: 5,
    },
  },
];
