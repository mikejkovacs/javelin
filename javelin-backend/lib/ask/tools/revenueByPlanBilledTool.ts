import { tool } from 'ai';
import { z } from 'zod';
import { revenueByPlanBilled } from '../../metrics/revenueByPlanBilled';
import type {
  StripeInvoiceLike,
} from '../../metrics/invoiceEnriched';
import type { StripeProductLike } from '../../metrics/revenueByPlan';
import { MAX_BUCKETS, bucketCount } from '../../metrics/bucketing';
import { fetchInvoices, fetchProducts } from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const REVENUE_BY_PLAN_BILLED_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
    granularity: z
      .enum(['day', 'week', 'month'])
      .optional()
      .describe(
        "Optional time-series granularity. Omit for a single period total. Set to 'day', 'week', or 'month' to return a per-(plan, currency) time series with dense zero-fill. Caps: day 90 days, week 52 weeks, month 36 months — fall back to coarser granularity for longer ranges.",
      ),
  })
  .strict();

export function buildRevenueByPlanBilledTool(accountId: string) {
  return tool({
    description:
      'Breaks period BILLED revenue (invoices, not charges) by plan name. Use for "revenue by plan", "which plans drive my revenue", "plan revenue trend" — pair with `revenue_by_plan` (collected/charges side) per RULE #9. Counts invoices with status in {paid, open, uncollectible} finalized in the period; voided + draft excluded. Plan attribution: per-line, summed across invoices (no first-line-wins shortcut). Multi-currency: rows carry their own currency, no FX (CRITICAL RULE #8). Returns rows sorted by currency-block dominance then amount; lines that cannot resolve to a plan name bucket as "unattributed". When `granularity` is set, returns a per-(plan, currency) time series with dense zero-fill. Inputs: start/end ISO; optional granularity.',
    inputSchema: REVENUE_BY_PLAN_BILLED_INPUT_SCHEMA,
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
              `revenue_by_plan_billed: ${granularity} granularity supports a max of ${max} buckets; given range produces ${count}. Use a coarser granularity (e.g., week or month) for longer ranges.`,
            );
          }
        }
        const [invoices, products] = await Promise.all([
          fetchInvoices(stripe, accountId, period),
          fetchProducts(stripe, accountId),
        ]);
        const baseInput = {
          invoices: invoices as unknown as StripeInvoiceLike[],
          products: products as unknown as StripeProductLike[],
          period,
          now: new Date(),
        };
        return granularity
          ? revenueByPlanBilled({ ...baseInput, granularity })
          : revenueByPlanBilled(baseInput);
      } catch (err) {
        console.error(
          '[ask] revenue_by_plan_billed tool execute() failed:',
          err,
        );
        throw err;
      }
    },
  });
}
