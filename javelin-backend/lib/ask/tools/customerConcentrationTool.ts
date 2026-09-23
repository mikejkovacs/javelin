import { tool } from 'ai';
import { z } from 'zod';
import { customerConcentration } from '../../metrics/customerConcentration';
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

export const CUSTOMER_CONCENTRATION_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
    top_n: z
      .number()
      .int()
      .positive()
      .default(5)
      .describe('Number of top customers to return in detail (default 5, max 10)'),
  })
  .strict();

export function buildCustomerConcentrationTool(accountId: string) {
  return tool({
    description:
      "Top-N customers by collected revenue in a date period, with concentration shares (top-1, top-5, top-10). Uses account default currency. Use `display_name` (name → email → 'an unnamed customer' fallback chain) when referring to customers — never `name` directly. Use for 'who is my top customer', 'customer concentration', 'top 5'.",
    inputSchema: CUSTOMER_CONCENTRATION_INPUT_SCHEMA,
    execute: async ({ start, end, top_n }) => {
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
        // customer_concentration takes ChargeEnrichedRow[] + CustomerRollupRow[]
        // (already enriched/rolled up). Run upstream primitives here.
        const enrichedCharges = chargeEnriched({
          charges,
          balanceTransactions,
          now,
        });
        // Cast: discounts.coupon is expanded in the fetcher so runtime values
        // are always Discount objects, but Stripe's static type still allows
        // string IDs in the union.
        const enrichedSubs = subscriptionEnriched({
          subscriptions: subscriptions as unknown as StripeSubscriptionLike[],
          now,
        });
        // Cast: Stripe.Customer.name allows undefined, primitive expects null.
        // Coerce undefined→null is a runtime no-op (the metric reads name only
        // for display lookup; null and undefined behave identically).
        const rollup = customerRollup({
          customers: customers as unknown as StripeCustomerLike[],
          charges: enrichedCharges.rows,
          subscriptions: enrichedSubs.rows,
          now,
        });
        const result = customerConcentration({
          charges: enrichedCharges.rows,
          customers: rollup.rows,
          period,
          default_currency: defaultCurrency,
          now,
        });
        // Truncate detailed rows to top_n requested (primitive returns up to 10).
        // Aggregate shares (top_1/top_5/top_10) remain unchanged.
        return {
          ...result,
          rows: result.rows.slice(0, top_n),
        };
      } catch (err) {
        console.error(
          '[ask] customer_concentration tool execute() failed:',
          err,
        );
        throw err;
      }
    },
  });
}
