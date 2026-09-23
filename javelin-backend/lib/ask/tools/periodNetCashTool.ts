import { tool } from 'ai';
import { z } from 'zod';
import { periodNetCash } from '../../metrics/periodNetCash';
import { fetchBalanceTransactions } from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const PERIOD_NET_CASH_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
  })
  .strict();

export function buildPeriodNetCashTool(accountId: string) {
  return tool({
    description:
      'Returns net cash that hit the bank in a date period (gross collected minus Stripe processing fees minus refunds minus chargebacks), per currency, with transaction count. Settlement-currency view. Use for "what hit my bank account", "net of Stripe fees", "deposits" questions, or to derive processing fees as the gap between collected_revenue and net_cash.',
    inputSchema: PERIOD_NET_CASH_INPUT_SCHEMA,
    execute: async ({ start, end }) => {
      try {
        const stripe = getStripeClient();
        const now = new Date();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        const balanceTransactions = await fetchBalanceTransactions(
          stripe,
          accountId,
          period,
        );
        return periodNetCash({ balanceTransactions, period, now });
      } catch (err) {
        console.error('[ask] period_net_cash tool execute() failed:', err);
        throw err;
      }
    },
  });
}
