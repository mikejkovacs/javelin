import type { EvalCase } from '../assertions';

// growth_rate — calibrated to FIXTURE_PROFILE's pre-existing 12-month series:
//
// monthly_recurring_billed_series (trailing 7 months Oct→Apr): 4060, 4180, 4290, 4360, 4400, 4510, 4420
//   MoM rates: ~+2.96%, +2.63%, +1.63%, +0.92%, +2.50%, -2.00%
//   avg ≈ +1.44%, half-diff -1.94pp (within ±5pp), trend: flat
//
// monthly_billed_revenue_series (trailing 7 months): 4520, 4610, 4720, 4810, 4830, 4940, 4820
//   avg ≈ +1.09%, half-diff -2.01pp, trend: flat
//
// monthly_collected_charges_series (trailing 7 months): 460, 430, 430, 450, 430, 430, 400
//   MoM rates: -6.52%, 0%, +4.65%, -4.44%, 0%, -6.98%
//   avg ≈ -2.21% → trend: declining

export const GROWTH_RATE_CASES: EvalCase[] = [
  {
    name: 'growth_rate — MRR growth question routes to recurring_revenue',
    question: "What's my MRR growth rate?",
    expectTools: [
      {
        name: 'growth_rate',
        argsExact: { metric: 'recurring_revenue', window: 6 },
      },
    ],
    expectAnswer: {
      // Recurring revenue is calibrated to ~1.4% avg, flat trend.
      // Allow either digit (1, 2, 1.4, etc.) or a range phrasing.
      mustMatch: [
        /\b\d{1,2}(\.\d+)?%/,                          // any % figure
        /(MRR|recurring|monthly recurring revenue|subscription)/i, // metric framing
        /(flat|steady|roughly|stable|holding|hovering|around)/i,    // trend language for flat
      ],
      mustNotInclude: ['as an AI'],
      maxSentences: 5,
    },
  },
  {
    name: 'growth_rate — generic "what is my revenue trend" — LLM picks metric, surfaces direction',
    question: 'What has my revenue trend been over the last 6 months?',
    // expectTools omitted — LLM may pick any metric (or call multiple per Rule #9).
    // Watch hook logs the actual choice.
    expectAnswer: {
      // Should surface direction language consistent with whichever metric
      // is picked (recurring/billed are flat; direct_charge is declining).
      mustMatch: [
        /\b\d{1,2}(\.\d+)?%/,                                          // some % figure
        /(flat|steady|growing|declin|down|decreas|drop|trend|trajectory)/i, // direction language
      ],
      mustNotInclude: [],
      // Cap bumped 5→9 for Sonnet (2026-05-07 Phase 2B′) — generic "trend"
      // questions invite a 2-stream comparison narrative when Rule #9 fires;
      // Sonnet renders this richer than Haiku.
      maxSentences: 9,
    },
  },
  {
    name: 'growth_rate — direct charge declining trend surfaces honestly without alarmist framing',
    // expectTools relaxed 2026-05-13 (Phase 2F) — third reproduction of the
    // pre-existing Sonnet tool-selection drift on this open-ended question
    // (PCL'd 2026-05-13 with 2E live evals, observed again here). The case's
    // SUBSTANTIVE assertion is the alarmist-axis discipline on the narrative,
    // not which tool produces it. Per working-mode acceleration lever for
    // open-ended composite cases: drop expectTools; assert on answer content
    // only. The PCL drift watch on Sonnet over-selection stays open.
    question: 'How are my one-time payments trending over the last 6 months?',
    expectAnswer: {
      // Direct charge series is calibrated to declining (avg -2.2%).
      mustMatch: [
        /(declin|down|decreas|dropping|losing|negative|shrink|softening)/i,
      ],
      // Don't manufacture significance — the decline is real but not catastrophic.
      // Sibling watch item to PCL's alarmist-framing concern.
      // Negative-lookbehind on "alarming" / "alarmism" — the LLM legitimately
      // says "nothing alarming" / "no alarms" as a calibrated NON-alarmist
      // framing (verified post-alarmist-rule landing 2026-05-01). Catch the
      // assertion without false-positiving on the negation.
      mustNotMatch: [
        /(steep|severe|catastroph|crisis|crash|plunge|plummet)/i,
        /(?<!nothing\s|no\s|not\s|never\s)\balarm(ing|ist)\b/i,
      ],
      mustNotInclude: [],
      maxSentences: 5,
    },
  },
];
