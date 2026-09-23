// Backend Stripe fetchers for V3 tools. Each function:
//   - takes a Stripe client + accountId (+ optional period)
//   - uses { stripeAccount: accountId } per request (Item 1 pattern)
//   - returns the raw Stripe resources the metric primitives expect
//
// V3 narrow slice — pagination caps tuned for typical small-merchant volume.
// Larger merchants would truncate at the cap; revisit when first observed.
//
// LATENCY INSTRUMENTATION (2026-05-13): each fetcher's public export is a
// `withTiming`-wrapped version of its internal `_fetchX` implementation. The
// wrapper emits a single `[TIMING] fetcher_end {...}` log line per call with
// duration_ms and row count. Public names (and import sites in tools) are
// unchanged — instrumentation is invisible to callers.

import type Stripe from 'stripe';
import type { Period } from '../metrics/types';
import { withTiming } from './timing';

const PAGINATION_LIMIT_SUBSCRIPTIONS = 1_000;
const PAGINATION_LIMIT_CANCELED_SUBSCRIPTIONS = 5_000;
const PAGINATION_LIMIT_CHARGES = 10_000;
const PAGINATION_LIMIT_BALANCE_TRANSACTIONS = 10_000;
// Per Q5.2 design pick (Chunk B / 1D): cap balance_explanation's window at
// 5K rows; surface a `truncated` flag when hit. Modern-Cents-shaped ICP
// merchants comfortably fit 30-day windows under this; revisit if a beta
// merchant exceeds it.
const PAGINATION_LIMIT_BALANCE_EXPLANATION = 5_000;
// Pending-only balance_transactions for account_balance enrichment (Q-A pick:
// fetch + filter client-side). Bounded by Stripe payout schedule (typically
// 2-7 days of activity); 1K is a comfortable ceiling for ICP merchants.
const PAGINATION_LIMIT_PENDING_BALANCE_TRANSACTIONS = 1_000;
const PAGINATION_LIMIT_INVOICES = 10_000;
const PAGINATION_LIMIT_CUSTOMERS = 10_000;
const PAGINATION_LIMIT_DISPUTES = 10_000;
// Phase 2C-post — products fetched for revenue_by_plan attribution fallback
// when price.nickname is unset and Stripe expand-depth cap blocks
// price.product expansion (4 segments already at the cap; product would be 5).
// Typical merchant has <50 lifetime products; 1K is a comfortable ceiling.
// `active: false` filter omitted (D2=B locked 2026-05-09) so historical
// charges referencing archived products still attribute correctly.
const PAGINATION_LIMIT_PRODUCTS = 1_000;

// Stripe API filters invoices by `created`, but the period_billed_revenue
// metric filters by `finalized_at`. An invoice created shortly before the
// period start may still finalize within it, so widen the left edge by 30
// days when fetching (matches V2 frontend pattern).
const INVOICE_LEFT_WIDENING_SECONDS = 30 * 24 * 60 * 60;

async function _fetchActiveSubscriptions(
  stripe: Stripe,
  accountId: string,
): Promise<Stripe.Subscription[]> {
  const reqOpts: Stripe.RequestOptions = { stripeAccount: accountId };
  // Expand discounts.coupon so subscription-level discounts arrive as full
  // Discount objects (not just string IDs) — subscriptionEnriched dereferences
  // discount.coupon.percent_off when computing monthly_normalized_amount.
  const expand = ['data.items.data.price', 'data.discounts.coupon'];
  const [active, pastDue] = await Promise.all([
    stripe.subscriptions
      .list({ status: 'active', limit: 100, expand }, reqOpts)
      .autoPagingToArray({ limit: PAGINATION_LIMIT_SUBSCRIPTIONS }),
    stripe.subscriptions
      .list({ status: 'past_due', limit: 100, expand }, reqOpts)
      .autoPagingToArray({ limit: PAGINATION_LIMIT_SUBSCRIPTIONS }),
  ]);
  return [...active, ...pastDue];
}

async function _fetchCanceledSubscriptions(
  stripe: Stripe,
  accountId: string,
  period: Period,
): Promise<Stripe.Subscription[]> {
  // Stripe's subscriptions.list does NOT accept an `ended_at` filter — only
  // `status` and `created`. We fetch all canceled subs and filter by `ended_at
  // IN period` client-side. The metric primitive re-checks defensively. Cap is
  // higher than active (1k) because canceled subs accumulate over a merchant's
  // lifetime; PCL watch item if a beta merchant exceeds ~2k or this gets slow.
  //
  // Expand mirrors fetchActiveSubscriptions — mrrMovement's churn pass falls
  // back to sub.items pricing when the last invoice is outside the invoice-
  // fetch window (annual/long-interval subs). Without expand, sub.items[].price
  // arrives as string IDs and the fallback computes the wrong amount.
  const expand = ['data.items.data.price', 'data.discounts.coupon'];
  const all = await stripe.subscriptions
    .list({ status: 'canceled', limit: 100, expand }, { stripeAccount: accountId })
    .autoPagingToArray({ limit: PAGINATION_LIMIT_CANCELED_SUBSCRIPTIONS });
  return all.filter(
    (sub) =>
      sub.ended_at != null &&
      sub.ended_at >= period.start &&
      sub.ended_at <= period.end,
  );
}

async function _fetchCharges(
  stripe: Stripe,
  accountId: string,
  period: Period,
): Promise<Stripe.Charge[]> {
  return stripe.charges
    .list(
      {
        limit: 100,
        created: { gte: period.start, lte: period.end },
      },
      { stripeAccount: accountId },
    )
    .autoPagingToArray({ limit: PAGINATION_LIMIT_CHARGES });
}

async function _fetchBalanceTransactions(
  stripe: Stripe,
  accountId: string,
  period: Period,
): Promise<Stripe.BalanceTransaction[]> {
  return stripe.balanceTransactions
    .list(
      {
        limit: 100,
        created: { gte: period.start, lte: period.end },
      },
      { stripeAccount: accountId },
    )
    .autoPagingToArray({ limit: PAGINATION_LIMIT_BALANCE_TRANSACTIONS });
}

/** Snapshot of /v1/balance for the merchant. */
async function _fetchBalance(
  stripe: Stripe,
  accountId: string,
): Promise<Stripe.Balance> {
  return stripe.balance.retrieve({}, { stripeAccount: accountId });
}

/** Currently-pending balance_transactions for the merchant — used to build the
 *  account_balance pending-settlement breakdown. Stripe SDK doesn't accept
 *  `status` as a list filter, so we fetch and filter client-side (Q-A pick).
 *  Pending rows are bounded by payout schedule; cap at 1K. */
async function _fetchPendingBalanceTransactions(
  stripe: Stripe,
  accountId: string,
): Promise<Stripe.BalanceTransaction[]> {
  const all = await stripe.balanceTransactions
    .list({ limit: 100 }, { stripeAccount: accountId })
    .autoPagingToArray({ limit: PAGINATION_LIMIT_PENDING_BALANCE_TRANSACTIONS });
  return all.filter((bt) => bt.status === 'pending');
}

/** Window-scoped balance_transactions with a smaller cap + `truncated` flag,
 *  for balance_explanation. Distinct from `fetchBalanceTransactions` which
 *  serves period_net_cash and friends with the higher 10K cap. */
async function _fetchBalanceTransactionsForExplanation(
  stripe: Stripe,
  accountId: string,
  period: Period,
): Promise<{ transactions: Stripe.BalanceTransaction[]; truncated: boolean }> {
  const transactions = await stripe.balanceTransactions
    .list(
      {
        limit: 100,
        created: { gte: period.start, lte: period.end },
      },
      { stripeAccount: accountId },
    )
    .autoPagingToArray({ limit: PAGINATION_LIMIT_BALANCE_EXPLANATION });
  // autoPagingToArray returns up to `limit` rows; if we hit it exactly,
  // we MIGHT have more. Treat that as truncated (over-flag is preferable
  // to under-flag — the LLM hedges its narrative when truncated).
  const truncated = transactions.length >= PAGINATION_LIMIT_BALANCE_EXPLANATION;
  return { transactions, truncated };
}

async function _fetchInvoices(
  stripe: Stripe,
  accountId: string,
  period: Period,
): Promise<Stripe.Invoice[]> {
  // Expand line-item prices so revenue_by_plan can read price.nickname.
  // Path is 4 segments (data → lines → data → price); within Stripe's expand
  // depth cap. period_billed_revenue doesn't read line items so the expand is
  // additive for its consumers.
  return stripe.invoices
    .list(
      {
        limit: 100,
        created: {
          gte: period.start - INVOICE_LEFT_WIDENING_SECONDS,
          lte: period.end,
        },
        expand: ['data.lines.data.price'],
      },
      { stripeAccount: accountId },
    )
    .autoPagingToArray({ limit: PAGINATION_LIMIT_INVOICES });
}

/** Phase 2C-post — separate-fetch-and-join workaround for the Stripe expand-
 *  depth cap on revenue_by_plan attribution. `fetchInvoices` already expands
 *  `data.lines.data.price` (depth 4 — at the cap); we cannot also expand
 *  `.product` without exceeding it. So we fetch products here and the
 *  `revenueByPlan` primitive joins by `price.product` (string ID) → product
 *  name. Returns active + inactive (D2=B locked) so historical charges
 *  referencing archived products still attribute correctly. */
async function _fetchProducts(
  stripe: Stripe,
  accountId: string,
): Promise<Stripe.Product[]> {
  return stripe.products
    .list({ limit: 100 }, { stripeAccount: accountId })
    .autoPagingToArray({ limit: PAGINATION_LIMIT_PRODUCTS });
}

async function _fetchDisputes(
  stripe: Stripe,
  accountId: string,
  period: Period,
): Promise<Stripe.Dispute[]> {
  return stripe.disputes
    .list(
      {
        limit: 100,
        created: { gte: period.start, lte: period.end },
      },
      { stripeAccount: accountId },
    )
    .autoPagingToArray({ limit: PAGINATION_LIMIT_DISPUTES });
}

async function _fetchCustomers(
  stripe: Stripe,
  accountId: string,
): Promise<Stripe.Customer[]> {
  return stripe.customers
    .list({ limit: 100 }, { stripeAccount: accountId })
    .autoPagingToArray({ limit: PAGINATION_LIMIT_CUSTOMERS });
}

// ── Customer entity tools (Chunk C / 2B) ─────────────────────────────────────

const PAGINATION_LIMIT_CUSTOMER_LOOKUP_FALLBACK = 1_000;
const PAGINATION_LIMIT_CUSTOMER_RECENT_ACTIVITY = 5_000;

/** Direct ID lookup for a single customer (Q1.2 strategy step 1). */
async function _retrieveCustomer(
  stripe: Stripe,
  accountId: string,
  customerId: string,
): Promise<Stripe.Customer | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId, {
      stripeAccount: accountId,
    });
    if ((customer as Stripe.DeletedCustomer).deleted) return null;
    return customer as Stripe.Customer;
  } catch (err: unknown) {
    // Stripe throws on 404 — surface as null instead of bubbling.
    const stripeErr = err as { code?: string; statusCode?: number };
    if (stripeErr?.statusCode === 404 || stripeErr?.code === 'resource_missing') {
      return null;
    }
    throw err;
  }
}

/** Stripe Customer Search by exact name across multiple Stripe fields.
 *  Stripe Dashboard's customer-name display falls back through a chain
 *  (name → individual_name → business_name → description → email), and
 *  many small merchants populate "the customer's name" into `description`
 *  (or business_name / individual_name) rather than `name`. To mirror
 *  Dashboard search behavior we run parallel exact-match queries on each
 *  field and dedupe by id. Hot-fix landed 2026-05-01 / Chunk C close
 *  (Joy Rowe finding — name field was null, "Joy Rowe" lived in
 *  description; original single-field query missed her entirely). */
async function _searchCustomersByName(
  stripe: Stripe,
  accountId: string,
  name: string,
): Promise<Stripe.Customer[]> {
  const escaped = name.replace(/'/g, "\\'");
  const fields = ['name', 'description', 'individual_name', 'business_name'];
  const results = await Promise.all(
    fields.map((field) =>
      stripe.customers
        .search(
          { query: `${field}:'${escaped}'`, limit: 100 },
          { stripeAccount: accountId },
        )
        .then((r) => r.data)
        // If a particular field isn't indexable for this account or returns
        // an error, swallow and keep going — partial results beat total
        // failure on a per-field syntax issue.
        .catch(() => [] as Stripe.Customer[]),
    ),
  );
  const seen = new Set<string>();
  const merged: Stripe.Customer[] = [];
  for (const batch of results) {
    for (const c of batch) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        merged.push(c);
      }
    }
  }
  return merged;
}

/** Stripe Customer Search by exact email (Q1.2 strategy step 2). */
async function _searchCustomersByEmail(
  stripe: Stripe,
  accountId: string,
  email: string,
): Promise<Stripe.Customer[]> {
  const escaped = email.replace(/'/g, "\\'");
  const result = await stripe.customers.search(
    { query: `email:'${escaped}'`, limit: 100 },
    { stripeAccount: accountId },
  );
  return result.data;
}

/** Q1.2 strategy step 3b — when name search returns 0, list customers
 *  (cap 1k) and prefix-match case-insensitively. Compares the input
 *  prefix against ANY of (name, description, individual_name,
 *  business_name) — same multi-field rationale as searchCustomersByName.
 *  Hot-fix landed 2026-05-01 / Chunk C close (Joy Rowe finding). */
async function _fetchCustomersForPrefixMatch(
  stripe: Stripe,
  accountId: string,
  namePrefix: string,
): Promise<{ matches: Stripe.Customer[]; truncated: boolean }> {
  const customers = await stripe.customers
    .list({ limit: 100 }, { stripeAccount: accountId })
    .autoPagingToArray({ limit: PAGINATION_LIMIT_CUSTOMER_LOOKUP_FALLBACK });
  const lower = namePrefix.toLowerCase();
  const matches = customers.filter((c) => {
    const candidates: Array<string | null | undefined> = [
      c.name,
      c.description,
      (c as unknown as { individual_name?: string | null }).individual_name,
      (c as unknown as { business_name?: string | null }).business_name,
    ];
    return candidates.some(
      (candidate) =>
        typeof candidate === 'string' &&
        candidate.toLowerCase().startsWith(lower),
    );
  });
  const truncated = customers.length >= PAGINATION_LIMIT_CUSTOMER_LOOKUP_FALLBACK;
  return { matches, truncated };
}

/** Per-customer charges, period-filtered. Used for both customer_lookup
 *  enrichment and customer_recent_activity. */
async function _fetchCustomerCharges(
  stripe: Stripe,
  accountId: string,
  customerId: string,
  period: Period,
): Promise<{ charges: Stripe.Charge[]; truncated: boolean }> {
  const charges = await stripe.charges
    .list(
      {
        customer: customerId,
        limit: 100,
        created: { gte: period.start, lte: period.end },
      },
      { stripeAccount: accountId },
    )
    .autoPagingToArray({ limit: PAGINATION_LIMIT_CUSTOMER_RECENT_ACTIVITY });
  const truncated = charges.length >= PAGINATION_LIMIT_CUSTOMER_RECENT_ACTIVITY;
  return { charges, truncated };
}

/** Per-customer invoices, period-filtered (by created — primitive then
 *  applies finalized_at filter for canonical billed-revenue date). */
async function _fetchCustomerInvoices(
  stripe: Stripe,
  accountId: string,
  customerId: string,
  period: Period,
): Promise<Stripe.Invoice[]> {
  return stripe.invoices
    .list(
      {
        customer: customerId,
        limit: 100,
        created: { gte: period.start, lte: period.end },
      },
      { stripeAccount: accountId },
    )
    .autoPagingToArray({ limit: PAGINATION_LIMIT_CUSTOMER_RECENT_ACTIVITY });
}

/** Per-customer subscriptions (any status, all-time). The primitive
 *  filters created/ended_at against the period for event emission. */
async function _fetchCustomerSubscriptions(
  stripe: Stripe,
  accountId: string,
  customerId: string,
): Promise<Stripe.Subscription[]> {
  return stripe.subscriptions
    .list(
      {
        customer: customerId,
        status: 'all',
        limit: 100,
      },
      { stripeAccount: accountId },
    )
    .autoPagingToArray({ limit: PAGINATION_LIMIT_CUSTOMER_RECENT_ACTIVITY });
}

/** Stripe Events API for customer.subscription.updated events in the period
 *  window. Stripe retains events for ~30 days; older changes can't be
 *  reconstructed without Sigma. We post-filter to events whose subscription
 *  belongs to the target customer (Events API has no `?customer=` filter
 *  for typed events). M2 Phase 2A — feeds subscription_item_change events
 *  in customer_recent_activity. */
import type { SubscriptionUpdateEvent } from '../metrics/customerRecentActivity';

const PAGINATION_LIMIT_SUBSCRIPTION_UPDATE_EVENTS = 1_000;

async function _fetchCustomerSubscriptionUpdateEvents(
  stripe: Stripe,
  accountId: string,
  customerId: string,
  period: Period,
): Promise<SubscriptionUpdateEvent[]> {
  const events = await stripe.events
    .list(
      {
        type: 'customer.subscription.updated',
        limit: 100,
        created: { gte: period.start, lte: period.end },
      },
      { stripeAccount: accountId },
    )
    .autoPagingToArray({ limit: PAGINATION_LIMIT_SUBSCRIPTION_UPDATE_EVENTS });

  const filtered: SubscriptionUpdateEvent[] = [];
  for (const evt of events) {
    const obj = evt.data?.object as Stripe.Subscription | undefined;
    if (!obj || obj.object !== 'subscription') continue;
    const evtCustomerId =
      typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
    if (evtCustomerId !== customerId) continue;

    const previous = (evt.data as { previous_attributes?: unknown })
      ?.previous_attributes as
      | { items?: { data?: Array<{ price?: { id?: string | null } | null }> } | null }
      | undefined;

    filtered.push({
      id: evt.id,
      created: evt.created,
      subscription: {
        id: obj.id,
        items: obj.items
          ? {
              data: obj.items.data.map((it) => ({
                price: it.price
                  ? {
                      id: it.price.id,
                      nickname: it.price.nickname ?? null,
                      product:
                        typeof it.price.product === 'string'
                          ? it.price.product
                          : it.price.product
                            ? { name: (it.price.product as Stripe.Product).name }
                            : null,
                    }
                  : null,
              })),
            }
          : null,
      },
      previous_attributes: previous ?? null,
    });
  }
  return filtered;
}

/** Per-customer disputes — Stripe disputes API has no `?customer=` filter.
 *  We fetch all disputes in window and let the primitive join client-side
 *  via charge.id. */
async function _fetchDisputesForCustomer(
  stripe: Stripe,
  accountId: string,
  period: Period,
): Promise<Stripe.Dispute[]> {
  return stripe.disputes
    .list(
      {
        limit: 100,
        created: { gte: period.start, lte: period.end },
      },
      { stripeAccount: accountId },
    )
    .autoPagingToArray({ limit: PAGINATION_LIMIT_CUSTOMER_RECENT_ACTIVITY });
}

async function _fetchAccountDefaultCurrency(
  stripe: Stripe,
  accountId: string,
): Promise<string> {
  // For Stripe-app installs, retrieve the merchant's account by ID.
  // accounts.retrieve(id) hits GET /v1/accounts/{id} and returns the
  // account's info (including default_currency) without requiring a separate
  // act-as Stripe-Account header — the platform key + app installation
  // grants the necessary read access.
  const account = await stripe.accounts.retrieve(accountId);
  if (!account.default_currency) {
    throw new Error(`[ask] Account ${accountId} has no default_currency`);
  }
  return account.default_currency.toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public exports — wrapped with `withTiming` so each call emits one
// `[TIMING] fetcher_end {...}` log line. Wrapping at the boundary keeps the
// implementations above unchanged and the public API stable for tool imports.
// ─────────────────────────────────────────────────────────────────────────────

export const fetchActiveSubscriptions = withTiming(
  'fetchActiveSubscriptions',
  'fetcher',
  _fetchActiveSubscriptions,
);
export const fetchCanceledSubscriptions = withTiming(
  'fetchCanceledSubscriptions',
  'fetcher',
  _fetchCanceledSubscriptions,
);
export const fetchCharges = withTiming('fetchCharges', 'fetcher', _fetchCharges);
export const fetchBalanceTransactions = withTiming(
  'fetchBalanceTransactions',
  'fetcher',
  _fetchBalanceTransactions,
);
export const fetchBalance = withTiming('fetchBalance', 'fetcher', _fetchBalance);
export const fetchPendingBalanceTransactions = withTiming(
  'fetchPendingBalanceTransactions',
  'fetcher',
  _fetchPendingBalanceTransactions,
);
export const fetchBalanceTransactionsForExplanation = withTiming(
  'fetchBalanceTransactionsForExplanation',
  'fetcher',
  _fetchBalanceTransactionsForExplanation,
);
export const fetchInvoices = withTiming('fetchInvoices', 'fetcher', _fetchInvoices);
export const fetchProducts = withTiming('fetchProducts', 'fetcher', _fetchProducts);
export const fetchDisputes = withTiming('fetchDisputes', 'fetcher', _fetchDisputes);
export const fetchCustomers = withTiming('fetchCustomers', 'fetcher', _fetchCustomers);
export const retrieveCustomer = withTiming(
  'retrieveCustomer',
  'fetcher',
  _retrieveCustomer,
);
export const searchCustomersByName = withTiming(
  'searchCustomersByName',
  'fetcher',
  _searchCustomersByName,
);
export const searchCustomersByEmail = withTiming(
  'searchCustomersByEmail',
  'fetcher',
  _searchCustomersByEmail,
);
export const fetchCustomersForPrefixMatch = withTiming(
  'fetchCustomersForPrefixMatch',
  'fetcher',
  _fetchCustomersForPrefixMatch,
);
export const fetchCustomerCharges = withTiming(
  'fetchCustomerCharges',
  'fetcher',
  _fetchCustomerCharges,
);
export const fetchCustomerInvoices = withTiming(
  'fetchCustomerInvoices',
  'fetcher',
  _fetchCustomerInvoices,
);
export const fetchCustomerSubscriptions = withTiming(
  'fetchCustomerSubscriptions',
  'fetcher',
  _fetchCustomerSubscriptions,
);
export const fetchCustomerSubscriptionUpdateEvents = withTiming(
  'fetchCustomerSubscriptionUpdateEvents',
  'fetcher',
  _fetchCustomerSubscriptionUpdateEvents,
);
export const fetchDisputesForCustomer = withTiming(
  'fetchDisputesForCustomer',
  'fetcher',
  _fetchDisputesForCustomer,
);
export const fetchAccountDefaultCurrency = withTiming(
  'fetchAccountDefaultCurrency',
  'fetcher',
  _fetchAccountDefaultCurrency,
);
