// Frontend Stripe fetchers.
//
// V3 narrow slice retired the V2 chat/plan orchestration; only the 8 fetchers
// the L1+L2 profile builder uses remain. V2-only fetchers (getAllSubscriptions,
// getAccount, getFailedPaymentInvoices, getPaymentIntents, getBalance,
// getBalanceTransactions, getPayouts, getApplicationFees, getTransfers,
// getDisputes, getReviews, getUserEmail, getUsageRecords, getCoupons,
// getPromotionCodes, getTaxTransactions, getMeterEvents) were deleted in T7
// 2026-04-28. Pattern C `UnsupportedResource` marker also retired — V3 LLM
// declines unsupported metrics gracefully via system prompt RULE #7.
//
// If a future tool needs a fetcher that was deleted, retrieve from git history
// or rebuild — the patterns are simple.

import type Stripe from 'stripe';
import { fetchAll } from './fetchAll';

/**
 * Subscriptions that contribute to MRR — both `active` and `past_due`.
 * Per metric-definitions.md, MRR includes past_due subs (collection-retry inflight).
 * Two parallel fetches; results concatenated. Expands `data.items.data.price` —
 * Stripe caps expansion at 4 levels, so product is NOT expanded here. As a result,
 * `subscription_enriched.plan_name` falls back to nickname-only in M1; full product-name
 * fallback requires a separate batch product fetch + client-side join (deferred to M2).
 */
export async function getActiveSubscriptions(stripe: Stripe) {
  const [active, pastDue] = await Promise.all([
    fetchAll(
      stripe.subscriptions.list({
        status: 'active',
        limit: 100,
        expand: ['data.items.data.price'],
      })
    ),
    fetchAll(
      stripe.subscriptions.list({
        status: 'past_due',
        limit: 100,
        expand: ['data.items.data.price'],
      })
    ),
  ]);
  return [...active, ...pastDue];
}

/**
 * Invoices that contribute to billed revenue: status IN (paid, open, uncollectible).
 * Per metric-definitions.md, period_billed_revenue includes paid + outstanding +
 * uncollectible (all finalized, recognizable). Excludes draft (not finalized) and
 * void (canceled).
 *
 * Date filter widens by 30 days on the left edge per M2.2-S3-B: Stripe API filters
 * by `created`, but the metric filters by `finalized_at`. An invoice created Feb 25
 * but finalized March 2 must be visible to a "March" query. The 30-day widen covers
 * typical manual-draft workflows. Scale concern: at scale this over-fetches; revisit
 * with per-merchant calibration or webhook-driven cache (see V2 spec M2.2 note).
 *
 * Three parallel fetches (Stripe's status filter accepts a single value, not a list).
 */
export async function getBilledInvoices(stripe: Stripe, startTs: number, endTs: number) {
  const widenedStart = startTs - 30 * 86400;
  const [paid, open, uncollectible] = await Promise.all([
    fetchAll(
      stripe.invoices.list({
        status: 'paid',
        created: { gte: widenedStart, lte: endTs },
        limit: 100,
        expand: ['data.lines.data.price'],
      })
    ),
    fetchAll(
      stripe.invoices.list({
        status: 'open',
        created: { gte: widenedStart, lte: endTs },
        limit: 100,
        expand: ['data.lines.data.price'],
      })
    ),
    fetchAll(
      stripe.invoices.list({
        status: 'uncollectible',
        created: { gte: widenedStart, lte: endTs },
        limit: 100,
        expand: ['data.lines.data.price'],
      })
    ),
  ]);
  return [...paid, ...open, ...uncollectible];
}

/** Subscriptions canceled in a date range. Used by L2 profile build for churn distribution. */
export async function getCanceledSubscriptions(stripe: Stripe, startTs: number, endTs: number) {
  const all = await fetchAll(
    stripe.subscriptions.list({
      status: 'canceled',
      limit: 100,
    })
  );
  return all.filter(
    (s) => s.canceled_at != null && s.canceled_at >= startTs && s.canceled_at <= endTs
  );
}

/** All products on the account — used by the profile builder (Item 23) to join
 *  product names into the catalog when a price has no nickname. Stripe's expand
 *  depth caps at 4 levels, so we can't get product names inline from
 *  subscriptions; a separate list is the workaround. Returns active products
 *  only — archived products aren't part of the merchant's current catalog. */
export async function getProducts(stripe: Stripe) {
  return fetchAll(stripe.products.list({ active: true, limit: 100 }));
}

/** Oldest charge on the account — used for the profile's `first_charge_date` field
 *  (Item 23 Phase 1, Layer 1). Stripe's list API returns charges in descending
 *  `created` order; to get the oldest we walk the SDK's auto-pagination and keep
 *  the last one seen.
 *
 *  Cost: this walks every charge in the account. At Merchant A scale (hundreds
 *  of charges) this is a few seconds. At enterprise scale this gets expensive;
 *  Phase 2 should move to a webhook-driven cache or a Sigma query. Acceptable
 *  for Phase 1 dogfooding per the ratified "cold window is OK" stance. */
export async function getOldestCharge(stripe: Stripe): Promise<{ created: number } | null> {
  let last: Stripe.Charge | undefined;
  for await (const charge of stripe.charges.list({ limit: 100 })) {
    last = charge;
  }
  return last ? { created: last.created } : null;
}

/** All non-deleted customers. Used by L1 profile for customer count + by L2 for
 *  customer-level analysis (top-customer concentration, new-customer distribution).
 *  Closes the customer-count bug (2026-04-15): customer_read scope was granted in V1
 *  but this fetcher was never wired up, causing Claude to confabulate counts from
 *  subscription data.
 *
 *  Filters out deleted customers (2026-04-16): Stripe's /v1/customers returns deleted
 *  customers as `{ id, deleted: true, object: "customer" }` tombstones by default,
 *  while the Dashboard excludes them. First post-item-3 Dashboard validation returned
 *  217 here vs 180 in the live Dashboard — 37 deleted tombstones. We exclude them at
 *  the fetcher level because no current question needs them; if that changes, add a
 *  separate `getDeletedCustomers` fetcher or an option flag. */
export async function getCustomers(stripe: Stripe) {
  const customers = await fetchAll(stripe.customers.list({ limit: 100 }));
  return customers.filter((c) => !c.deleted);
}

/** Charges in a date range. Used by L2 profile for monthly direct-charge revenue series. */
export async function getCharges(stripe: Stripe, startTs: number, endTs: number) {
  return fetchAll(
    stripe.charges.list({
      created: { gte: startTs, lte: endTs },
      limit: 100,
    })
  );
}

/** All connected accounts on the platform. Used by L1 profile to detect Connect
 *  business shape (when present, business_shape includes 'connect').
 *
 *  Stripe's `accounts.list` endpoint is only valid for *platform* accounts; when
 *  called from a non-Connect-platform account (e.g. a standard merchant, or a
 *  merchant that is itself a connected account of some other platform) the API
 *  rejects with an `invalid_request_error` whose message begins
 *  "You cannot access the connected accounts…". Observed 2026-04-23 against
 *  Merchant A in live mode.
 *
 *  We swallow that specific error and return [] — for our purposes, "cannot
 *  list" and "no connected accounts" are business-equivalent (neither makes
 *  this a Connect platform). Any other error propagates as before. */
export async function getConnectedAccounts(stripe: Stripe) {
  try {
    return await fetchAll(stripe.accounts.list({ limit: 100 }));
  } catch (err) {
    const message = (err as { message?: string })?.message ?? '';
    const type = (err as { type?: string })?.type ?? '';
    const isNonPlatform =
      type === 'StripeInvalidRequestError' &&
      message.toLowerCase().includes('connected accounts');
    if (isNonPlatform) return [];
    throw err;
  }
}
