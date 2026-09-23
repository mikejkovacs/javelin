import type { EvalCase } from '../assertions';

// period_net_cash — calibrated to FIXTURE:
//   March 2026: $3,586 across 5 transactions (after fees + refund + chargeback)

export const PERIOD_NET_CASH_CASES: EvalCase[] = [
  {
    name: 'period_net_cash — last month after fees',
    question: 'How much hit my bank last month after fees?',
    expectTools: [
      {
        name: 'period_net_cash',
        argsExact: { start: '2026-03-01', end: '2026-03-31' },
      },
    ],
    expectAnswer: {
      mustInclude: ['$3,586'],
      mustNotInclude: ['cents', 'bt_', 'cus_'],
      maxSentences: 5,
    },
  },
];
