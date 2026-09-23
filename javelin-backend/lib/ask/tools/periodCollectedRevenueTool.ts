import { tool } from 'ai';
import { z } from 'zod';
import { periodCollectedRevenue } from '../../metrics/periodCollectedRevenue';
import { fetchCharges, fetchBalanceTransactions } from '../fetchers';
import { getStripeClient } from '../stripeClient';

// Validate ISO date format AND that the date is real (e.g. rejects "2026-13-45",
// which the regex alone passes). Catches LLM-emitted bad dates at Zod validation
// rather than letting them flow into NaN-producing Date math downstream.
const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const PERIOD_COLLECTED_REVENUE_INPUT_SCHEMA = z
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

export function buildPeriodCollectedRevenueTool(accountId: string) {
  return tool({
    description:
      'Returns total collected revenue (sum of succeeded charges minus refunds) for a date period, per currency, with charge count. Use for "how much did I collect", "gross volume", "net revenue after refunds" questions. Pass `exclude_fraud: true` for the fraud-clean view; per-currency `fraud_excluded` reports the dollar volume removed.',
    inputSchema: PERIOD_COLLECTED_REVENUE_INPUT_SCHEMA,
    execute: async ({ start, end, exclude_fraud }) => {
      try {
        const stripe = getStripeClient();
        const now = new Date();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        const [charges, balanceTransactions] = await Promise.all([
          fetchCharges(stripe, accountId, period),
          fetchBalanceTransactions(stripe, accountId, period),
        ]);
        return periodCollectedRevenue({
          charges,
          balanceTransactions,
          period,
          now,
          excludeFraud: exclude_fraud,
        });
      } catch (err) {
        console.error(
          '[ask] period_collected_revenue tool execute() failed:',
          err,
        );
        throw err;
      }
    },
  });
}
