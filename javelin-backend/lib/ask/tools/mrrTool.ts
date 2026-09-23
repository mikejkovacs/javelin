import { tool } from 'ai';
import { z } from 'zod';
import { mrr } from '../../metrics/mrr';
import type { StripeSubscriptionLike } from '../../metrics/subscriptionEnriched';
import { fetchActiveSubscriptions } from '../fetchers';
import { getStripeClient } from '../stripeClient';

export const MRR_INPUT_SCHEMA = z.object({}).strict();

export function buildMrrTool(accountId: string) {
  return tool({
    description:
      "Returns current MRR (monthly recurring revenue, the run rate of monthly subscription billing) per currency, with subscription count. MRR is a now-snapshot — it has no date inputs.",
    inputSchema: MRR_INPUT_SCHEMA,
    execute: async () => {
      try {
        const stripe = getStripeClient();
        const subscriptions = await fetchActiveSubscriptions(stripe, accountId);
        // Cast: discounts.coupon is expanded in the fetcher so runtime values
        // are always Discount objects, but Stripe's static type still allows
        // string IDs in the union.
        return mrr({
          subscriptions: subscriptions as unknown as StripeSubscriptionLike[],
          now: new Date(),
        });
      } catch (err) {
        console.error('[ask] mrr tool execute() failed:', err);
        throw err;
      }
    },
  });
}
