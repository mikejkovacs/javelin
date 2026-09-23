import type { EvalCase } from '../assertions';

// goal_eta — calibrated against FIXTURE_PROFILE (today 2026-04-29):
//
// recurring_revenue (current=4420, rate≈0.0144, trend flat):
//   target=5500 → ceil(log(5500/4420)/log(1.0144)) = ceil(15.3) = 16 months
//                 eta = 2026-04 + 16 = 2027-08
//   target=100000 → ~218 months → unreachable, too_distant
//
// direct_charge_revenue (current=400, rate=-0.0221, declining):
//   target=600 → rate < 0 AND target > current → unreachable, declining
//
// customer_count (current=312, net=14, trend growing):
//   target=500 → ceil((500-312)/14) = ceil(13.43) = 14 months
//                eta = now (2026-04) + 14 = 2027-06

export const GOAL_ETA_CASES: EvalCase[] = [
  {
    name: 'goal_eta — recurring_revenue reachable mid-horizon',
    question: 'When will I hit $5,500 in MRR?',
    expectTools: [
      {
        name: 'goal_eta',
        argsExact: {
          metric: 'recurring_revenue',
          target_value: 5500,
          lookback_months: 6,
        },
      },
    ],
    expectAnswer: {
      mustMatch: [
        // Months ~16 or eta month name (Aug 2027 / 2027). Allow either form.
        /(\b1[4-8]\b|2027|august|aug)/i,
        // Conditional verb tense.
        /(would|you'?d|cross|reach)/i,
        // Trend label disclosed (flat is the calibrated label).
        /(flat|holding|steady|stable|hovering|roughly|trajectory)/i,
        /(if|assum(ing|e)|holds?|current)/i,
      ],
      mustNotMatch: [
        /\byou\s+will\s+(hit|reach|cross|land)\b/i,
        /\byou'?ll\s+(hit|reach|cross|land)\b/i,
      ],
      mustNotInclude: ['as an AI'],
      maxSentences: 5,
    },
  },
  {
    name: 'goal_eta — recurring_revenue unreachable too_distant',
    question: 'When will I hit $100K MRR?',
    expectTools: [
      {
        name: 'goal_eta',
        argsExact: {
          metric: 'recurring_revenue',
          target_value: 100000,
          lookback_months: 6,
        },
      },
    ],
    expectAnswer: {
      mustMatch: [
        // Honest framing — accept any of: explicit unreachable verdict
        // (one word OR "not reachable" two-word variant), multi-year framing
        // ("over N years" / "X+ years" / "decades"), or distance language.
        /(unreachable|(?:isn'?t|not)\s+reachable|too\s+(?:far|distant)|out\s+of\s+range|outside\s+(?:any|a|the)?\s*(?:useful|practical|reasonable|sensible)?\s*(?:planning\s+)?horizon|beyond|more\s+than\s+\d+\s+years?|60\+|over\s+\d+\s+years|decades?|\d+\+\s+years?|years?\s+out|practical\s+horizon|reasonable\s+horizon)/i,
      ],
      mustNotMatch: [
        // Don't fabricate a specific reachable ETA inside the next few years.
        /\b202[6-9]\b/,
        /\bin\s+(?:about|around|roughly)\s+\d+\s+(?:months?|years?)\b/i,
      ],
      mustNotInclude: [],
      maxSentences: 5,
    },
  },
  {
    name: 'goal_eta — customer_count reachable',
    question: 'When will I hit 500 customers?',
    expectTools: [
      {
        name: 'goal_eta',
        argsExact: {
          metric: 'customer_count',
          target_value: 500,
          lookback_months: 6,
        },
      },
    ],
    expectAnswer: {
      mustMatch: [
        // ~14 months or 2027 / June.
        /(\b1[2-6]\b|2027|june|jun)/i,
        // Customer-count-specific assumption disclosure.
        /(assum(ing|e)|stay(?:ing|s)?\s+flat|current\s+rates?)/i,
        /(would|you'?d|reach|hit)/i,
      ],
      mustNotMatch: [
        /\byou\s+will\s+(hit|reach|cross|land)\b/i,
        /\byou'?ll\s+(hit|reach|cross|land)\b/i,
      ],
      mustNotInclude: [],
      maxSentences: 5,
    },
  },
  {
    name: 'goal_eta — direct_charge unreachable declining',
    question: 'When will my one-time-payment revenue cross $600 per month?',
    expectTools: [
      {
        name: 'goal_eta',
        argsExact: {
          metric: 'direct_charge_revenue',
          target_value: 600,
          lookback_months: 6,
        },
      },
    ],
    expectAnswer: {
      mustMatch: [
        // Honest "unreachable / declining" framing.
        /(declin|down|decreas|negative|trending\s+down|won'?t\s+(?:reach|hit)|not\s+on\s+track)/i,
      ],
      mustNotMatch: [
        // No fabricated optimistic ETA.
        /\bin\s+(?:about|around|roughly)\s+\d+\s+(?:months?|years?)\b/i,
        /\b202[6-9]\b/,
        // No alarmism (axis #3 sibling guard).
        /(steep|severe|catastroph|crisis|crash|plunge|plummet|collapse)/i,
      ],
      mustNotInclude: [],
      maxSentences: 5,
    },
  },
];
