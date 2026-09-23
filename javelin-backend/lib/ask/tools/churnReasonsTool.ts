import { tool } from 'ai';
import { z } from 'zod';
import { churnReasons } from '../../metrics/churnReasons';
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

export const CHURN_REASONS_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
  })
  .strict();

export function buildChurnReasonsTool(accountId: string) {
  return tool({
    description:
      "Counts customer-stated cancellation reasons (Stripe Customer Portal feedback) in a date period. Buckets: too_expensive, missing_features, switched_service, unused, customer_service, low_quality, too_complex, other, plus 'none' for cancellations without feedback. Use for 'why did customers cancel'. Inputs: start/end ISO. Returns `coverage`: 'none' (narrate as 'we don't have customer-stated reasons'), 'partial' (narrate with caveat), 'high' (narrate buckets directly). When feedback_provided is 1-2 entries, narrate literally — don't extrapolate.",
    inputSchema: CHURN_REASONS_INPUT_SCHEMA,
    execute: async ({ start, end }) => {
      try {
        const stripe = getStripeClient();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        const subs = await fetchCanceledSubscriptions(stripe, accountId, period);
        return churnReasons({
          subscriptions: subs as unknown as StripeSubscriptionLike[],
          period,
          now: new Date(),
        });
      } catch (err) {
        console.error('[ask] churn_reasons tool execute() failed:', err);
        throw err;
      }
    },
  });
}
