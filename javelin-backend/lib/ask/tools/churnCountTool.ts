import { tool } from 'ai';
import { z } from 'zod';
import { churnCount } from '../../metrics/churnCount';
import type { StripeSubscriptionLike } from '../../metrics/subscriptionEnriched';
import { fetchCanceledSubscriptions } from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const CHURN_COUNT_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
  })
  .strict();

export function buildChurnCountTool(accountId: string) {
  return tool({
    description:
      "Subscriptions whose MRR contribution ended in a date period, split by reason: voluntary, involuntary (payment failures), other (disputes), unknown. Use for 'how many churned', 'cancellations last quarter'. Inputs: start/end ISO. `breakdown_significance`: 'meaningful' (narrate the split), 'too_few'/'single_bucket' (lead with total only).",
    inputSchema: CHURN_COUNT_INPUT_SCHEMA,
    execute: async ({ start, end }) => {
      try {
        const stripe = getStripeClient();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        const subs = await fetchCanceledSubscriptions(stripe, accountId, period);
        return churnCount({
          subscriptions: subs as unknown as StripeSubscriptionLike[],
          period,
          now: new Date(),
        });
      } catch (err) {
        console.error('[ask] churn_count tool execute() failed:', err);
        throw err;
      }
    },
  });
}
