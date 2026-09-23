import { tool } from 'ai';
import { z } from 'zod';
import { payingCustomerCount } from '../../metrics/payingCustomerCount';
import type { StripeChargeLike } from '../../metrics/chargeEnriched';
import { fetchCharges } from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const PAYING_CUSTOMER_COUNT_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
    exclude_fraud: z
      .boolean()
      .optional()
      .describe(
        'Optional. When true, succeeded charges flagged fraudulent (charge.fraud_details.user_report or stripe_report = "fraudulent") are excluded. Use when the user says "real numbers", "after fraud", "minus fraud", "true revenue", or "actuals". Default false matches Stripe Dashboard behavior.',
      ),
  })
  .strict();

export function buildPayingCustomerCountTool(accountId: string) {
  return tool({
    description:
      "Distinct customers who paid in a date period — flow metric, NOT total customer base. Use for 'how many customers paid me last month'. Do NOT use for 'how many customers do I have' (state question — use profile envelope or active_subscription_count for subs). Annual-plan businesses see undercounts on short periods. Pass exclude_fraud:true for actuals. Inputs: start/end ISO, optional exclude_fraud. Returns total count, with_customer_record (distinct IDs), guest_payments (charges without customer), fraud_excluded_charges (when filter on).",
    inputSchema: PAYING_CUSTOMER_COUNT_INPUT_SCHEMA,
    execute: async ({ start, end, exclude_fraud }) => {
      try {
        const stripe = getStripeClient();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        const charges = await fetchCharges(stripe, accountId, period);
        return payingCustomerCount({
          charges: charges as unknown as StripeChargeLike[],
          period,
          now: new Date(),
          excludeFraud: exclude_fraud,
        });
      } catch (err) {
        console.error('[ask] paying_customer_count tool execute() failed:', err);
        throw err;
      }
    },
  });
}
