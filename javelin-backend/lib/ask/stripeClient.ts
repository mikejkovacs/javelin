import Stripe from 'stripe';

let _client: Stripe | null = null;

/**
 * Backend Stripe client for V3 tool fetchers. Uses the platform secret key;
 * tool fetchers pass `{ stripeAccount: accountId }` per request to scope to
 * the merchant (Item 1 backend-credentials pattern).
 *
 * Edge-runtime safe via fetch-based HTTP client.
 *
 * V3 narrow slice = single mode. STRIPE_SECRET_KEY is whichever mode you're
 * deploying for (live for production). Multi-mode handling deferred.
 */
export function getStripeClient(): Stripe {
  if (_client) return _client;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error(
      'STRIPE_SECRET_KEY env var not set — V3 backend cannot fetch Stripe data',
    );
  }
  _client = new Stripe(apiKey, {
    apiVersion: '2026-02-25.clover',
    httpClient: Stripe.createFetchHttpClient(),
  });
  return _client;
}
