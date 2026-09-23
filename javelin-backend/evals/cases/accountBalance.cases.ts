import type { EvalCase } from '../assertions';

// account_balance — calibrated to FIXTURE_BALANCE + FIXTURE_PENDING_BALANCE_TRANSACTIONS:
//   available[0]:        usd $3,500
//   pending[0]:          usd $1,200
//   instant_available:   null
//   pending_settlement_breakdown:
//     2026-04-30 / usd / $485 / 1
//     2026-05-01 / usd / $388 / 1
//     2026-05-03 / usd / $339.50 / 1

export const ACCOUNT_BALANCE_CASES: EvalCase[] = [
  {
    name: 'account_balance — current balance',
    question: "What's my Stripe balance?",
    expectTools: [{ name: 'account_balance', argsExact: {} }],
    expectAnswer: {
      // Available figure + pending figure both surface; cents may collapse to
      // dollars in narration ($3,500 / $3500). Accept either.
      mustMatch: [/\$3,?500/, /\$1,?200/],
      // Avoid Stripe IDs, raw cents, markdown asterisks.
      mustNotInclude: ['cents', 'bt_', 'usd_'],
      maxSentences: 4,
    },
  },
  {
    name: 'account_balance — balance synonym',
    question: 'How much money is in my Stripe account?',
    expectTools: [{ name: 'account_balance', argsExact: {} }],
    expectAnswer: {
      mustMatch: [/\$3,?500/],
      mustNotInclude: [],
      maxSentences: 4,
    },
  },
  {
    name: 'account_balance — pending settles when',
    question: 'When does my pending balance become available?',
    expectTools: [{ name: 'account_balance', argsExact: {} }],
    expectAnswer: {
      // At least one settlement date should appear (ISO or natural-language
      // forms both acceptable). The three dates in the fixture: 2026-04-30,
      // 2026-05-01, 2026-05-03.
      mustMatch: [
        /(2026-04-30|April 30|Apr 30|2026-05-01|May 1|May 01|2026-05-03|May 3|May 03|tomorrow|next few days)/i,
      ],
      // Asterisk allowed — settlement-date breakdown is naturally a list,
      // formatted with bullets per system prompt (Type B fix 2026-05-07).
      mustNotInclude: ['bt_'],
      maxSentences: 5,
    },
  },
];
