import { tool } from 'ai';
import { z } from 'zod';
import { largestCharges } from '../../metrics/largestCharges';
import { chargeEnriched } from '../../metrics/chargeEnriched';
import {
  customerRollup,
  type StripeCustomerLike,
} from '../../metrics/customerRollup';
import {
  subscriptionEnriched,
  type StripeSubscriptionLike,
} from '../../metrics/subscriptionEnriched';
import {
  fetchCharges,
  fetchBalanceTransactions,
  fetchCustomers,
  fetchActiveSubscriptions,
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

export const LARGEST_CHARGES_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
    n: z
      .number()
      .int()
      .positive()
      .max(10)
      .default(5)
      .describe('Number of largest charges to return (default 5, max 10)'),
  })
  .strict();

export function buildLargestChargesTool(accountId: string) {
  return tool({
    description:
      "Top-N individual charges by net collected amount in a date period (default n=5, max 10). Each row: amount, currency, customer display_name, date, refunded/disputed flags. Use for 'largest single charges', 'biggest payments'. NOT for aggregate revenue totals (use period_collected_revenue).",
    inputSchema: LARGEST_CHARGES_INPUT_SCHEMA,
    execute: async ({ start, end, n }) => {
      try {
        const stripe = getStripeClient();
        const now = new Date();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        const [
          charges,
          balanceTransactions,
          customers,
          subscriptions,
          defaultCurrency,
        ] = await Promise.all([
          fetchCharges(stripe, accountId, period),
          fetchBalanceTransactions(stripe, accountId, period),
          fetchCustomers(stripe, accountId),
          fetchActiveSubscriptions(stripe, accountId),
          fetchAccountDefaultCurrency(stripe, accountId),
        ]);
        const enrichedCharges = chargeEnriched({
          charges,
          balanceTransactions,
          now,
        });
        const enrichedSubs = subscriptionEnriched({
          subscriptions: subscriptions as unknown as StripeSubscriptionLike[],
          now,
        });
        const rollup = customerRollup({
          customers: customers as unknown as StripeCustomerLike[],
          charges: enrichedCharges.rows,
          subscriptions: enrichedSubs.rows,
          now,
        });
        return largestCharges({
          charges: enrichedCharges.rows,
          customers: rollup.rows,
          period,
          default_currency: defaultCurrency,
          n,
          now,
        });
      } catch (err) {
        console.error('[ask] largest_charges_in_period tool execute() failed:', err);
        throw err;
      }
    },
  });
}
