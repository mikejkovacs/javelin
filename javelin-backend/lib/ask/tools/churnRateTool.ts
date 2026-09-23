import { tool } from 'ai';
import { z } from 'zod';
import { churnRate } from '../../metrics/churnRate';
import type { StripeSubscriptionLike } from '../../metrics/subscriptionEnriched';
import {
  fetchActiveSubscriptions,
  fetchCanceledSubscriptions,
} from '../fetchers';
import { getStripeClient } from '../stripeClient';

const ROLLING_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

export const CHURN_RATE_INPUT_SCHEMA = z.object({}).strict();

export function buildChurnRateTool(accountId: string) {
  return tool({
    description:
      "Stripe's canonical 30-day rolling subscriber churn rate. Fixed 30-day window — no period input. Use for 'what's my churn rate', 'subscriber churn rate'. Returns rate + component counts (churned_30d, active_30d_ago, new_30d). If denominator is zero, returns `value: null` — narrate as 'not enough subscriber history yet'. Do NOT compute non-canonical 'monthly'/'quarterly' churn rates from arbitrary periods; for period-bound count questions use `churn_count`.",
    inputSchema: CHURN_RATE_INPUT_SCHEMA,
    execute: async () => {
      try {
        const stripe = getStripeClient();
        const now = new Date();
        const nowSec = Math.floor(now.getTime() / 1000);
        const window = {
          start: nowSec - ROLLING_DAYS * SECONDS_PER_DAY,
          end: nowSec,
        };
        const [active, canceled] = await Promise.all([
          fetchActiveSubscriptions(stripe, accountId),
          fetchCanceledSubscriptions(stripe, accountId, window),
        ]);
        return churnRate({
          active_subscriptions: active as unknown as StripeSubscriptionLike[],
          canceled_subscriptions: canceled as unknown as StripeSubscriptionLike[],
          now,
        });
      } catch (err) {
        console.error('[ask] churn_rate tool execute() failed:', err);
        throw err;
      }
    },
  });
}
