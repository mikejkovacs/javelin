import { tool } from 'ai';
import { z } from 'zod';
import { periodNetRevenue } from '../../metrics/periodNetRevenue';
import type { StripeDisputeLike } from '../../metrics/periodNetRevenue';
import {
  fetchCharges,
  fetchBalanceTransactions,
  fetchDisputes,
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

export const PERIOD_NET_REVENUE_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
    exclude_fraud: z
      .boolean()
      .optional()
      .describe(
        'Optional. When true, succeeded charges flagged fraudulent (charge.fraud_details.user_report or stripe_report = "fraudulent") are excluded from gross_collected and refunds. Chargebacks line is independent (those are realized losses, not flagged fraud signals). Use when the user says "real numbers", "after fraud", "minus fraud", "true revenue", or "actuals". Default false matches Stripe Dashboard behavior.',
      ),
  })
  .strict();

export function buildPeriodNetRevenueTool(accountId: string) {
  return tool({
    description:
      'Returns net revenue (gross collected minus refunds minus chargebacks) for a date period, per currency. Excludes Stripe processing fees — those are an operating expense, not a revenue contra. For the bank-deposit / post-fee view, use period_net_cash. Use for "net revenue", "revenue after refunds and chargebacks", "revenue net of disputes" questions. Pass `exclude_fraud: true` for the actuals lens; per-currency `fraud_excluded` reports the dollar volume removed.',
    inputSchema: PERIOD_NET_REVENUE_INPUT_SCHEMA,
    execute: async ({ start, end, exclude_fraud }) => {
      try {
        const stripe = getStripeClient();
        const now = new Date();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        const [charges, balanceTransactions, disputes] = await Promise.all([
          fetchCharges(stripe, accountId, period),
          fetchBalanceTransactions(stripe, accountId, period),
          fetchDisputes(stripe, accountId, period),
        ]);
        // Cast: Stripe.Dispute.status is a typed union; the primitive
        // accepts a generic string and gates on a known-status set internally.
        return periodNetRevenue({
          charges,
          balanceTransactions,
          disputes: disputes as unknown as StripeDisputeLike[],
          period,
          now,
          excludeFraud: exclude_fraud,
        });
      } catch (err) {
        console.error('[ask] period_net_revenue tool execute() failed:', err);
        throw err;
      }
    },
  });
}
