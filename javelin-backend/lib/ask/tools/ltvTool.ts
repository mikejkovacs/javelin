import { tool } from 'ai';
import { z } from 'zod';
import { ltv } from '../../metrics/ltv';
import type { StripeSubscriptionLike } from '../../metrics/subscriptionEnriched';
import {
  fetchActiveSubscriptions,
  fetchCanceledSubscriptions,
} from '../fetchers';
import { getStripeClient } from '../stripeClient';

const CHURN_WINDOW_VALUES = ['30d', '90d', '365d'] as const;

export const LTV_INPUT_SCHEMA = z
  .object({
    churn_window: z
      .enum(CHURN_WINDOW_VALUES)
      .optional()
      .describe(
        'Churn rate window for the LTV formula. Default 30d matches Stripe Billing\'s canonical metric. Widen to 90d or 365d when the 30d window has no observed churn (common for small subscriber bases); wider windows diverge from what Stripe Dashboard shows but extract usable signal from older churn data.',
      ),
  })
  .strict();

// Canceled-subs fetcher window: we need a period for the fetcher; pick wide
// enough to cover the longest LTV window (365d) plus a safety margin so the
// underlying subscriberChurnRateForWindow primitive can re-filter correctly.
const CANCELED_FETCH_WINDOW_DAYS = 400;

export function buildLtvTool(accountId: string) {
  return tool({
    description:
      // Stripe-canonical LTV per the Billing analytics glossary. Cross-pointers
      // to ARPU + churn_rate name the underlying inputs explicitly so the LLM
      // understands the composition. Scope flag baked into description per the
      // Path Z pattern from growth_attribution (Phase 2E) — Merchant A
      // production validation showed this is sufficient for the LLM to surface
      // scope clarification without a separate voice rule.
      'Subscriber Lifetime Value: estimates how much revenue a subscriber generates over their full lifetime. Formula is Stripe-canonical: LTV = ARPU ÷ subscriber churn rate (matches Stripe Billing\'s LTV chart exactly when called with default 30d window). Returns per-currency LTV in major units, plus implied subscriber lifetime in months. Default churn_window of "30d" matches Stripe Dashboard exactly. When 30d returns null (no observed churn — common for small subscriber bases like 5-10 active subs), offer the merchant a wider 90d or 365d window OR call the tool again with churn_window: "90d" / "365d" to compute from older churn signal — but surface that the wider-window LTV diverges from what Stripe Dashboard would show. When the envelope\'s low_sample flag is set, phrase the uncertainty in business terms — "with a small subscriber base, treat this as directional" — never reference the field name itself. SCOPE: Stripe subscription billing only — does NOT include one-off charges or per-customer cumulative revenue from non-subscription sources. For "how much revenue per customer" (cumulative, historical) use customer_spend_distribution instead.',
    inputSchema: LTV_INPUT_SCHEMA,
    execute: async ({ churn_window }) => {
      try {
        const stripe = getStripeClient();
        const now = new Date();
        const nowSec = Math.floor(now.getTime() / 1000);
        const period = {
          start: nowSec - CANCELED_FETCH_WINDOW_DAYS * 86_400,
          end: nowSec,
        };
        const [activeSubscriptions, canceledSubscriptions] = await Promise.all([
          fetchActiveSubscriptions(stripe, accountId),
          fetchCanceledSubscriptions(stripe, accountId, period),
        ]);
        return ltv({
          subscriptions: activeSubscriptions as unknown as StripeSubscriptionLike[],
          active_subscriptions: activeSubscriptions as unknown as StripeSubscriptionLike[],
          canceled_subscriptions: canceledSubscriptions as unknown as StripeSubscriptionLike[],
          churn_window,
          now,
        });
      } catch (err) {
        console.error('[ask] ltv tool execute() failed:', err);
        throw err;
      }
    },
  });
}
