import { tool } from 'ai';
import { z } from 'zod';
import { arpu } from '../../metrics/arpu';
import type { StripeSubscriptionLike } from '../../metrics/subscriptionEnriched';
import type { StripeChargeLike } from '../../metrics/chargeEnriched';
import {
  fetchActiveSubscriptions,
  fetchCharges,
  fetchBalanceTransactions,
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

export const ARPU_INPUT_SCHEMA = z
  .object({
    basis: z
      .enum(['recurring', 'collected'])
      .describe(
        'Required. "recurring" = MRR ÷ active subscription count (run-rate, no period). "collected" = period_collected_revenue ÷ paying_customer_count over a date range (period flow basis, period required).',
      ),
    start: isoDate('start')
      .optional()
      .describe(
        'Period start, ISO YYYY-MM-DD. Required when basis="collected". Ignored when basis="recurring".',
      ),
    end: isoDate('end')
      .optional()
      .describe(
        'Period end, ISO YYYY-MM-DD (inclusive). Required when basis="collected". Ignored when basis="recurring".',
      ),
  })
  .strict()
  .refine(
    (v) => v.basis !== 'collected' || (v.start !== undefined && v.end !== undefined),
    {
      message: 'start and end are required when basis="collected"',
    },
  );

export function buildArpuTool(accountId: string) {
  return tool({
    description:
      'Mean revenue per paying customer (NEVER median — for median use customer_spend_distribution). Pick `basis`: "recurring" = MRR ÷ active subscriptions (run-rate, no period); "collected" = period_collected_revenue ÷ paying_customer_count over a date range (period flow, period required). For hybrid merchants where both subs and one-time payments are material, call BOTH bases and present each lens distinctly — they measure different things, do not average them (mirrors RULE #9). Returns per-currency rows: arpu, source_revenue (numerator), customer_count (denominator), basis, low_sample (true when <10 customers). Inputs: basis (required), start/end ISO (required when basis="collected").',
    inputSchema: ARPU_INPUT_SCHEMA,
    execute: async ({ basis, start, end }) => {
      try {
        const stripe = getStripeClient();
        const now = new Date();

        if (basis === 'recurring') {
          const subscriptions = await fetchActiveSubscriptions(stripe, accountId);
          return arpu({
            basis: 'recurring',
            subscriptions: subscriptions as unknown as StripeSubscriptionLike[],
            now,
          });
        }

        // basis === 'collected' — refine guarantees start/end exist
        const period = {
          start: Math.floor(new Date(start! + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end! + 'T23:59:59Z').getTime() / 1000),
        };
        const [charges, balanceTransactions] = await Promise.all([
          fetchCharges(stripe, accountId, period),
          fetchBalanceTransactions(stripe, accountId, period),
        ]);
        return arpu({
          basis: 'collected',
          charges: charges as unknown as StripeChargeLike[],
          balanceTransactions,
          period,
          now,
        });
      } catch (err) {
        console.error('[ask] arpu tool execute() failed:', err);
        throw err;
      }
    },
  });
}
