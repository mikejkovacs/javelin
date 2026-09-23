import type Stripe from 'stripe';

/**
 * Fetches all pages of a Stripe list endpoint by following auto-pagination.
 * Stripe returns max 100 items per page.
 */
export async function fetchAll<T>(
  listPromise: Stripe.ApiListPromise<T>
): Promise<T[]> {
  const results: T[] = [];
  for await (const item of listPromise) {
    results.push(item);
  }
  return results;
}
