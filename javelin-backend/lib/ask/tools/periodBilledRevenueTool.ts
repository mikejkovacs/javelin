import { tool } from 'ai';
import { z } from 'zod';
import { periodBilledRevenue } from '../../metrics/periodBilledRevenue';
import type { StripeInvoiceLike } from '../../metrics/invoiceEnriched';
import { fetchInvoices } from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const PERIOD_BILLED_REVENUE_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
  })
  .strict();

export function buildPeriodBilledRevenueTool(accountId: string) {
  return tool({
    description:
      'Returns total billed revenue (sum of invoice subtotals where status is paid, open, or uncollectible) for a date period, per currency, with invoice count. Filtered by finalized_at (Stripe RevRec methodology). Use for "what was Q4 revenue", "billed revenue", "invoiced revenue" questions.',
    inputSchema: PERIOD_BILLED_REVENUE_INPUT_SCHEMA,
    execute: async ({ start, end }) => {
      try {
        const stripe = getStripeClient();
        const now = new Date();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        const invoices = await fetchInvoices(stripe, accountId, period);
        // Cast: Stripe deprecated top-level Invoice.tax field, but the metric
        // primitive's StripeInvoiceLike still requires it. periodBilledRevenue
        // uses subtotal (pre-tax) so tax isn't actually consumed for this metric.
        return periodBilledRevenue({
          invoices: invoices as unknown as StripeInvoiceLike[],
          period,
          now,
        });
      } catch (err) {
        console.error(
          '[ask] period_billed_revenue tool execute() failed:',
          err,
        );
        throw err;
      }
    },
  });
}
