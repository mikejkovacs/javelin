import { tool } from 'ai';
import { z } from 'zod';
import { revenueByPlan } from '../../metrics/revenueByPlan';
import type { StripeChargeLike } from '../../metrics/chargeEnriched';
import type { StripeInvoiceLike } from '../../metrics/invoiceEnriched';
import type { StripeProductLike } from '../../metrics/revenueByPlan';
import { MAX_BUCKETS, bucketCount } from '../../metrics/bucketing';
import {
  fetchCharges,
  fetchInvoices,
  fetchAccountDefaultCurrency,
  fetchProducts,
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

export const REVENUE_BY_PLAN_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
    granularity: z
      .enum(['day', 'week', 'month'])
      .optional()
      .describe(
        "Optional time-series granularity. Omit for a single period total (existing behavior). Set to 'day', 'week', or 'month' to return a per-bucket time series with dense zero-fill. Caps: day max 90 days, week max 52 weeks, month max 36 months — exceeding throws an error and the tool description teaches falling back to a coarser granularity.",
      ),
  })
  .strict();

export function buildRevenueByPlanTool(accountId: string) {
  return tool({
    description:
      "Breaks period COLLECTED revenue (charges only) by plan name. Use for 'revenue by plan', 'which plan made the most money'. For generic 'revenue' questions, pair with `period_billed_revenue` (RULE #9). Returns sorted rows per plan with amount, charge count, share. Non-subscription charges appear as 'unattributed'. Single-currency (account default). When `granularity` is set ('day'|'week'|'month'), returns a per-plan time series with dense zero-fill — use for 'which plans are growing', 'plan revenue over time', 'daily/weekly/monthly plan trend' questions. Granularity caps: day 90 days, week 52 weeks, month 36 months — for longer ranges fall back to coarser granularity. Inputs: start/end ISO; optional granularity.",
    inputSchema: REVENUE_BY_PLAN_INPUT_SCHEMA,
    execute: async ({ start, end, granularity }) => {
      try {
        const stripe = getStripeClient();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        if (granularity) {
          const count = bucketCount(period, granularity);
          const max = MAX_BUCKETS[granularity];
          if (count > max) {
            throw new Error(
              `revenue_by_plan: ${granularity} granularity supports a max of ${max} buckets; given range produces ${count}. Use a coarser granularity (e.g., week or month) for longer ranges.`,
            );
          }
        }
        const [charges, invoices, currency, products] = await Promise.all([
          fetchCharges(stripe, accountId, period),
          fetchInvoices(stripe, accountId, period),
          fetchAccountDefaultCurrency(stripe, accountId),
          fetchProducts(stripe, accountId),
        ]);
        const baseInput = {
          charges: charges as unknown as StripeChargeLike[],
          invoices: invoices as unknown as StripeInvoiceLike[],
          products: products as unknown as StripeProductLike[],
          period,
          currency,
          now: new Date(),
        };
        return granularity
          ? revenueByPlan({ ...baseInput, granularity })
          : revenueByPlan(baseInput);
      } catch (err) {
        console.error('[ask] revenue_by_plan tool execute() failed:', err);
        throw err;
      }
    },
  });
}
