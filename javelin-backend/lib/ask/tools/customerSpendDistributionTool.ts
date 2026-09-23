import { tool } from 'ai';
import { z } from 'zod';
import { customerSpendDistribution } from '../../metrics/customerSpendDistribution';
import { chargeEnriched } from '../../metrics/chargeEnriched';
import {
  fetchCharges,
  fetchBalanceTransactions,
  fetchAccountDefaultCurrency,
} from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const CUSTOMER_SPEND_DISTRIBUTION_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
  })
  .strict();

export function buildCustomerSpendDistributionTool(accountId: string) {
  return tool({
    description:
      "Per-customer spend distribution in a date period: median, p25, p75, p90, mean, paying_customer_count, top_1_share, bottom_50_share. Account default currency. low_sample:true when <5 customers — disclose. Use for 'median customer spend', 'how does my top customer compare to typical/median'. Do NOT compute median yourself (revenue ÷ count = mean, not median — call this tool instead).",
    inputSchema: CUSTOMER_SPEND_DISTRIBUTION_INPUT_SCHEMA,
    execute: async ({ start, end }) => {
      try {
        const stripe = getStripeClient();
        const now = new Date();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        const [charges, balanceTransactions, defaultCurrency] = await Promise.all([
          fetchCharges(stripe, accountId, period),
          fetchBalanceTransactions(stripe, accountId, period),
          fetchAccountDefaultCurrency(stripe, accountId),
        ]);
        const enrichedCharges = chargeEnriched({
          charges,
          balanceTransactions,
          now,
        });
        return customerSpendDistribution({
          charges: enrichedCharges.rows,
          period,
          default_currency: defaultCurrency,
          now,
        });
      } catch (err) {
        console.error(
          '[ask] customer_spend_distribution tool execute() failed:',
          err,
        );
        throw err;
      }
    },
  });
}
