import { tool } from 'ai';
import { z } from 'zod';
import { activeSubscriptionCount } from '../../metrics/activeSubscriptionCount';
import type { StripeSubscriptionLike } from '../../metrics/subscriptionEnriched';
import { fetchActiveSubscriptions } from '../fetchers';
import { getStripeClient } from '../stripeClient';

export const ACTIVE_SUBSCRIPTION_COUNT_INPUT_SCHEMA = z.object({}).strict();

export function buildActiveSubscriptionCountTool(accountId: string) {
  return tool({
    description:
      "Active subscription count, now-snapshot. Use for 'how many active subscriptions', 'subscriber count'. Do NOT call when the user asks about MRR or revenue (use `mrr`). If `mrr` was already called this response, the count is in its `subscription_count` field — don't double-call.",
    inputSchema: ACTIVE_SUBSCRIPTION_COUNT_INPUT_SCHEMA,
    execute: async () => {
      try {
        const stripe = getStripeClient();
        const subscriptions = await fetchActiveSubscriptions(stripe, accountId);
        return activeSubscriptionCount({
          subscriptions: subscriptions as unknown as StripeSubscriptionLike[],
          now: new Date(),
        });
      } catch (err) {
        console.error(
          '[ask] active_subscription_count tool execute() failed:',
          err,
        );
        throw err;
      }
    },
  });
}
