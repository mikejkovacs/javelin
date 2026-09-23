import { tool } from 'ai';
import { z } from 'zod';
import { failedPayments } from '../../metrics/failedPayments';
import type { StripeChargeLike } from '../../metrics/chargeEnriched';
import type { StripeInvoiceLike } from '../../metrics/invoiceEnriched';
import { fetchCharges, fetchInvoices } from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const FAILED_PAYMENTS_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
    top_n: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe(
        'How many largest individual failures to return in top_failures. Default 5, max 20. Pass higher when the user asks for more (e.g., "top 10 failed payments").',
      ),
  })
  .strict();

export function buildFailedPaymentsTool(accountId: string) {
  return tool({
    description:
      'Failed payment volume in a date period — failed charges (charge.status="failed") plus failed invoice payment attempts (invoices with attempt_count>0 and status open/uncollectible). This is "money the customer tried to send you but didn\'t successfully arrive." Use for "what failed last month", "how much in failed payments", "biggest failed charges", "uncollected revenue", "money I missed out on" questions. NOT for refunds (intentional reversals) or chargebacks (already in period_net_revenue). Returns per-currency rows with total_failed, count, and a breakdown of failed_charges vs failed_invoice_attempts; `top_failures` (up to 5 largest individual failures by default, configurable via top_n) with customer display name + amount + date + failure_type; `failure_reasons` (top 3 operator-friendly categories: insufficient_funds, expired_card, card_declined, stolen_or_lost_card, authentication_failed, processing_error, other) — useful when narrating WHY payments failed. Inputs: start/end ISO dates, optional top_n.',
    inputSchema: FAILED_PAYMENTS_INPUT_SCHEMA,
    execute: async ({ start, end, top_n }) => {
      try {
        const stripe = getStripeClient();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        // Reuse existing fetchers — no new Stripe API surface needed.
        // fetchCharges returns ALL charges in period (incl. failed); the
        // primitive filters by status='failed'. fetchInvoices returns ALL
        // invoices; primitive filters by attempt_count + status.
        // Volume risk: high-volume merchants approaching the 10K cap on
        // fetchCharges will see truncation. PCL entry tracks the trigger
        // condition for migrating to Stripe Search API.
        const [charges, invoices] = await Promise.all([
          fetchCharges(stripe, accountId, period),
          fetchInvoices(stripe, accountId, period),
        ]);
        return failedPayments({
          charges: charges as unknown as StripeChargeLike[],
          invoices: invoices as unknown as StripeInvoiceLike[],
          period,
          now: new Date(),
          topN: top_n,
        });
      } catch (err) {
        console.error('[ask] failed_payments tool execute() failed:', err);
        throw err;
      }
    },
  });
}
