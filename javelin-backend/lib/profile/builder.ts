// Profile builder — Item 23 Phase 1, Layer 1 only.
//
// Pure orchestrator over Stripe fetchers + 5b metrics. Inputs:
//   - stripe: a Stripe client (frontend-scoped in Phase 1; backend-scoped in Phase 2)
//   - mode: 'live' | 'test' (determines secret_store key, P1-S7)
//   - now:   for testability + deterministic builtAt
//
// Output: Profile (per P1-S4 Option 1 shape; empty fields omitted per P1-S8 A).
//
// Iteration discipline (P1-S3 refinement):
//   - Builder emits raw values only (cents → major, ISO codes, distributions).
//   - Field formatting + classification thresholds live in backend
//     `injectProfile` so the high-iteration prompt surface is backend-side.

import {
  subscriptionEnriched,
  chargeEnriched,
  mrr,
  periodBilledRevenue,
  customerConcentration,
  toMajor,
} from '../metrics';
import {
  PROFILE_SCHEMA_VERSION,
  type Profile,
  type Layer1,
  type Layer2,
  type StripeMode,
  type CatalogPlan,
  type MixRow,
  type BusinessShape,
  type Distribution,
  type MonthlyAmount,
  type TopCustomerConcentration,
} from './types';
import type { ChargeEnrichedRow } from '../metrics/chargeEnriched';
import type { StripeInvoiceLike } from '../metrics/invoiceEnriched';

// ── Shape (minimal Stripe subsets we read) ──────────────────────────────────

interface ChargeForMix {
  amount: number;            // minor units (used for share weighting)
  currency: string;
  status: 'succeeded' | 'pending' | 'failed';
  created: number;
  payment_method_details?: { type?: string | null } | null;
  /** Stripe sets this when the charge was created to pay an invoice.
   *  null = direct charge. Used for L2's monthly_collected_charges_series
   *  to dedupe against billed revenue. */
  invoice?: string | null;
}

/** Minimal canceled-subscription shape for L2 — only timestamps needed. */
interface CanceledSubscriptionForL2 {
  /** Unix seconds — when the subscription was created. */
  created: number;
  /** Unix seconds — when the subscription was canceled. Should be non-null
   *  for status='canceled' subs but defensive against Stripe API quirks. */
  canceled_at: number | null;
}

// ── Builder dependencies — injectable for testing ───────────────────────────
//
// We accept fetcher functions rather than calling them directly so the builder
// is unit-testable without a live Stripe client. The frontend wires the real
// fetchers from javelin/src/utils/stripeData.ts; the cross-merchant isolation
// vitest passes synthetic data.

export interface BuildProfileDeps {
  // unbounded list of "active" subscriptions (active + past_due) for catalog + MRR
  getActiveSubscriptions: () => Promise<Parameters<typeof subscriptionEnriched>[0]['subscriptions']>;
  // non-deleted customers for customer count
  getCustomers: () => Promise<Array<unknown>>;
  // active products — used to join product names into the catalog when a price
  // has no nickname. Stripe's `expand` depth cap prevents inline product
  // expansion through subscription items, so we fetch separately and join.
  // Optional: omit in tests that don't exercise the join.
  getProducts?: () => Promise<Array<{ id: string; name?: string | null }>>;
  // charges in a date range, used for trailing-12m mixes + revenue
  getCharges: (startTs: number, endTs: number) => Promise<Parameters<typeof chargeEnriched>[0]['charges']>;
  // billed invoices in a date range, used for trailing-12m revenue
  getBilledInvoices: (startTs: number, endTs: number) => Promise<Parameters<typeof periodBilledRevenue>[0]['invoices']>;
  // connected accounts for Connect business-shape signal
  getConnectedAccounts: () => Promise<Array<unknown>>;
  // oldest charge ever — for first_charge_date. Pagination cost noted; fine
  // for Phase 1 dogfooding scale, revisit at scale.
  getOldestCharge: () => Promise<{ created: number } | null>;
  // canceled subscriptions in a date range — NEW for L2 (churn distribution
  // + avg subscription lifetime). Frontend's existing fetcher fits this
  // signature; the post-fetch filter in stripeData.ts narrows by canceled_at.
  getCanceledSubscriptions: (startTs: number, endTs: number) => Promise<CanceledSubscriptionForL2[]>;
}

export interface BuildProfileInput {
  mode: StripeMode;
  now: Date;
  deps: BuildProfileDeps;
  /** Previously-stored profile, if any. Used to carry forward
   *  `l2_build_error.attempt_count` across consecutive failed L2 builds.
   *  Reset to 1 on first failure after a successful L2 build. */
  previousProfile?: Profile | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Top-N distribution from weighted entries. Returns rows summing to 1.
 *  Empty input returns []. */
function topN(weights: Map<string, number>, n: number): MixRow[] {
  const total = Array.from(weights.values()).reduce((s, w) => s + w, 0);
  if (total <= 0) return [];
  return Array.from(weights.entries())
    .map(([key, weight]) => ({ key, share: weight / total }))
    .sort((a, b) => b.share - a.share)
    .slice(0, n);
}

/** Format a Unix-seconds timestamp as 'YYYY-MM' (UTC). */
function monthKeyOf(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const year = d.getUTCFullYear();
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

/** Returns the trailing N month keys ending at `now`'s UTC month (inclusive),
 *  oldest → newest. E.g., trailingMonthKeys(2026-04-15, 6) →
 *  ['2025-11','2025-12','2026-01','2026-02','2026-03','2026-04']. */
function trailingMonthKeys(now: Date, nMonths: number): string[] {
  const keys: string[] = [];
  for (let i = nMonths - 1; i >= 0; i--) {
    // Date.UTC handles negative months by rolling the year back.
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const year = d.getUTCFullYear();
    const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    keys.push(`${year}-${month}`);
  }
  return keys;
}

/** Median of a numeric array. Empty → 0. Even length → mean of two middles. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Distribution from a per-month count series. Returns null if total events
 *  across the window is < 6 (conservative inference threshold per spec —
 *  Item 23 "≥6 data points before inferring patterns"). The window size
 *  itself becomes `n_months` so the interpreter knows the sample basis. */
function distributionFromMonthlyCounts(counts: number[]): Distribution | null {
  const totalEvents = counts.reduce((s, c) => s + c, 0);
  if (totalEvents < 6) return null;
  return {
    min: Math.min(...counts),
    median: median(counts),
    max: Math.max(...counts),
    n_months: counts.length,
  };
}

// ── L2 builder (private) ────────────────────────────────────────────────────
//
// Computes the 8 Layer 2 fields from already-fetched data + L1's just-built
// envelope. Pure function — caller wraps in try/catch and emits the L2
// envelope or `l2_build_error` based on whether this throws.
//
// Currency selection:
//   - Billed series (#1, #2): `layer1.scale.annual_revenue_currency` —
//     the currency L1 already chose as dominant for invoiced revenue.
//   - Charge series (#3) + customer concentration (#6):
//     `layer1.currency_mix[0].key` — dominant charge currency. May
//     differ from billed currency for hybrid businesses; intentional.

interface BuildLayer2Input {
  billedInvoices: StripeInvoiceLike[];
  charges: ChargeForMix[];
  chEnrichedRows: ChargeEnrichedRow[];
  customers: Array<unknown>;
  canceledSubs: CanceledSubscriptionForL2[];
  layer1: Layer1;
  now: Date;
  oneYearAgoTs: number;
  nowTs: number;
}

function buildLayer2(input: BuildLayer2Input): Layer2 {
  const {
    billedInvoices, charges, chEnrichedRows,
    customers, canceledSubs, layer1, now, oneYearAgoTs, nowTs,
  } = input;

  const layer2: Layer2 = {
    builtAt: now.toISOString(),
  };

  const billedCurrency = layer1.scale?.annual_revenue_currency;
  const chargeCurrency = layer1.currency_mix?.[0]?.key;

  const months12 = trailingMonthKeys(now, 12);
  const months6 = trailingMonthKeys(now, 6);

  // ── 1. monthly_billed_revenue_series ──────────────────────────────────────
  // Sum invoice subtotals (post-discount, pre-tax) by `created` month, in
  // dominant billed-revenue currency. Includes paid + open + uncollectible.
  if (billedCurrency) {
    const series = new Map<string, number>(months12.map((k) => [k, 0]));
    for (const inv of billedInvoices) {
      if (inv.currency !== billedCurrency) continue;
      const key = monthKeyOf(inv.created);
      if (!series.has(key)) continue;
      series.set(key, (series.get(key) ?? 0) + inv.subtotal);
    }
    const total = Array.from(series.values()).reduce((s, v) => s + v, 0);
    if (total > 0) {
      layer2.monthly_billed_revenue_series = monthlyAmountSeries(
        months12, series, billedCurrency
      );
    }
  }

  // ── 2. monthly_recurring_billed_series ───────────────────────────────────
  // Sum line-item amounts where the line is recurring, binned by the
  // invoice's `created` month. Matches Stripe's Billing-report semantics:
  // shows what was BILLED for recurring lines each month. Yearly bills
  // appear as spikes — the interpreter is taught to acknowledge that.
  //
  // Schema-gap fix 2026-05-13 (PCL "$375 vs $371 drift investigation"):
  // dual-shape detection. Legacy Stripe API uses `line.price.recurring`;
  // new API (2024-2025 restructure) uses `line.pricing.type === 'recurring'`.
  // Without dual-shape reading, this series silently produces zero on
  // new-API merchants — the same schema-gap class as `revenue_by_plan` had
  // before 2C-post-v2.
  if (billedCurrency) {
    const series = new Map<string, number>(months12.map((k) => [k, 0]));
    for (const inv of billedInvoices) {
      if (inv.currency !== billedCurrency) continue;
      const key = monthKeyOf(inv.created);
      if (!series.has(key)) continue;
      let recurringMinor = 0;
      for (const line of inv.lines.data) {
        const isRecurring =
          line.price?.recurring != null ||
          line.pricing?.type === 'recurring';
        if (!isRecurring) continue;
        recurringMinor += line.amount ?? 0;
      }
      series.set(key, (series.get(key) ?? 0) + recurringMinor);
    }
    const total = Array.from(series.values()).reduce((s, v) => s + v, 0);
    if (total > 0) {
      layer2.monthly_recurring_billed_series = monthlyAmountSeries(
        months12, series, billedCurrency
      );
    }
  }

  // ── 3. monthly_collected_charges_series ───────────────────────────────────
  // Direct charges only (`charge.invoice == null`), succeeded, in dominant
  // charge currency. Avoids double-counting with billed series — invoice-
  // paying charges are excluded; the invoice itself appears in #1.
  if (chargeCurrency) {
    const series = new Map<string, number>(months12.map((k) => [k, 0]));
    for (const c of charges) {
      if (c.status !== 'succeeded') continue;
      if (c.invoice != null) continue;
      if (c.currency !== chargeCurrency) continue;
      const key = monthKeyOf(c.created);
      if (!series.has(key)) continue;
      series.set(key, (series.get(key) ?? 0) + c.amount);
    }
    const total = Array.from(series.values()).reduce((s, v) => s + v, 0);
    if (total > 0) {
      layer2.monthly_collected_charges_series = monthlyAmountSeries(
        months12, series, chargeCurrency
      );
    }
  }

  // ── 4. churn_distribution ─────────────────────────────────────────────────
  // Bin canceled subs by `canceled_at` month over trailing 6m. Emits only
  // when total cancellations >= 6 (conservative inference).
  {
    const counts = bucketByMonth(months6, canceledSubs, (s) => s.canceled_at);
    const distrib = distributionFromMonthlyCounts(months6.map((m) => counts.get(m) ?? 0));
    if (distrib) layer2.churn_distribution = distrib;
  }

  // ── 5. failed_payment_distribution ────────────────────────────────────────
  // Count uncollectible invoices per month over trailing 6m.
  {
    const uncollectible = billedInvoices.filter((i) => i.status === 'uncollectible');
    const counts = bucketByMonth(months6, uncollectible, (i) => i.created);
    const distrib = distributionFromMonthlyCounts(months6.map((m) => counts.get(m) ?? 0));
    if (distrib) layer2.failed_payment_distribution = distrib;
  }

  // ── 6. new_customer_distribution ──────────────────────────────────────────
  // Count customers by `created` month over trailing 6m.
  {
    const counts = bucketByMonth(months6, customers, (c) => {
      const created = (c as { created?: number }).created;
      return typeof created === 'number' ? created : null;
    });
    const distrib = distributionFromMonthlyCounts(months6.map((m) => counts.get(m) ?? 0));
    if (distrib) layer2.new_customer_distribution = distrib;
  }

  // ── 7. top_customer_concentration ─────────────────────────────────────────
  // Rank customers by trailing-12m revenue in dominant charge currency.
  // Omit when customer_count < 10 (top_10 would be 100%) or when the
  // ranking has no revenue to compute concentration over.
  if (
    chargeCurrency &&
    layer1.scale?.customer_count != null &&
    layer1.scale.customer_count >= 10
  ) {
    const result = customerConcentration({
      charges: chEnrichedRows,
      customers: [],
      period: { start: oneYearAgoTs, end: nowTs },
      default_currency: chargeCurrency,
      now,
    });
    if (result.total_collected > 0) {
      const concentration: TopCustomerConcentration = {
        top_1_share: result.value.top_1_share,
        top_5_share: result.value.top_5_share,
        top_10_share: result.value.top_10_share,
        currency: chargeCurrency,
      };
      layer2.top_customer_concentration = concentration;
    }
  }

  // ── 8. avg_subscription_lifetime_days ─────────────────────────────────────
  // Mean (canceled_at - created) / 86400 across canceled subs in trailing
  // 12m. Omit when fewer than 6 cancellations have valid timestamps.
  {
    const lifetimes: number[] = [];
    for (const sub of canceledSubs) {
      if (sub.canceled_at == null) continue;
      if (sub.canceled_at <= sub.created) continue;
      lifetimes.push((sub.canceled_at - sub.created) / 86400);
    }
    if (lifetimes.length >= 6) {
      const sum = lifetimes.reduce((s, v) => s + v, 0);
      layer2.avg_subscription_lifetime_days = sum / lifetimes.length;
    }
  }

  return layer2;
}

/** Convert a {monthKey → minor-amount} Map into a sorted MonthlyAmount[]. */
function monthlyAmountSeries(
  monthKeys: string[],
  series: Map<string, number>,
  currency: string,
): MonthlyAmount[] {
  return monthKeys.map((m) => ({
    month: m,
    amount: toMajor(series.get(m) ?? 0, currency),
    currency,
  }));
}

/** Bucket items into per-month counts using a timestamp extractor.
 *  Items whose timestamps fall outside the provided month keys are skipped. */
function bucketByMonth<T>(
  monthKeys: string[],
  items: T[],
  getUnixSec: (t: T) => number | null | undefined,
): Map<string, number> {
  const counts = new Map<string, number>(monthKeys.map((k) => [k, 0]));
  for (const t of items) {
    const ts = getUnixSec(t);
    if (typeof ts !== 'number') continue;
    const key = monthKeyOf(ts);
    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function buildProfile(input: BuildProfileInput): Promise<Profile> {
  const { mode, now, deps, previousProfile } = input;
  const nowTs = Math.floor(now.getTime() / 1000);
  const oneYearAgoTs = nowTs - 365 * 24 * 60 * 60;

  // Parallel fetches — total cold-window cost dominated by the slowest fetch.
  const [
    activeSubs,
    customers,
    products,
    charges12m,
    billedInvoices12m,
    connectedAccounts,
    oldestCharge,
    canceledSubs12m,
  ] = await Promise.all([
    deps.getActiveSubscriptions(),
    deps.getCustomers(),
    deps.getProducts ? deps.getProducts() : Promise.resolve([]),
    deps.getCharges(oneYearAgoTs, nowTs),
    deps.getBilledInvoices(oneYearAgoTs, nowTs),
    deps.getConnectedAccounts(),
    deps.getOldestCharge(),
    deps.getCanceledSubscriptions(oneYearAgoTs, nowTs),
  ]);

  // Build a quick product_id → name lookup for the catalog join. Excludes
  // products with empty/null names so the fallback chain
  // (nickname || product_name || '') skips truly nameless products.
  const productNameById = new Map<string, string>();
  for (const p of products) {
    if (p.name) productNameById.set(p.id, p.name);
  }

  // ── Compute shared metric outputs once ────────────────────────────────────
  const subEnriched = subscriptionEnriched({ subscriptions: activeSubs, now });
  const chEnriched = chargeEnriched({
    charges: charges12m,
    balanceTransactions: [],
    now,
  });
  const mrrResult = mrr({ subscriptions: activeSubs, now });
  const billedRevenue12m = periodBilledRevenue({
    invoices: billedInvoices12m,
    period: { start: oneYearAgoTs, end: nowTs },
    now,
  });

  // ── Assemble L1 envelope ──────────────────────────────────────────────────
  const layer1: Layer1 = {
    builtAt: now.toISOString(),
  };

  // ── 1. business_shape ────────────────────────────────────────────────────
  // Multiple shapes can coexist (subscription-heavy SaaS that also takes
  // one-off Checkout payments, etc.). Detection rules:
  //   - subscription:   any contributes_to_mrr row
  //   - one_time:       any succeeded charge (12m window) — the 12m cap is OK
  //                     because if they have NO charges in 12m they aren't
  //                     a one-time-active business today
  //   - connect:        any connected accounts on the platform
  const shapes: BusinessShape[] = [];
  if (subEnriched.rows.some((r) => r.contributes_to_mrr)) shapes.push('subscription');
  if (charges12m.some((c) => c.status === 'succeeded')) shapes.push('one_time');
  if (connectedAccounts.length > 0) shapes.push('connect');
  if (shapes.length > 0) layer1.business_shape = shapes;

  // ── 2. catalog ────────────────────────────────────────────────────────────
  // Group active+past_due subs by (plan_name, currency); sum monthly amounts.
  // Excludes dormant plan rows (no active subs on a plan it isn't in catalog).
  //
  // plan_name fallback chain: price.nickname (already in row.plan_name) →
  // product.name (from the parallel products fetch) → ''. Without the product
  // join, prices without nicknames produce empty plan names, which defeats
  // the "use plan names verbatim" injection rule.
  const catalogMap = new Map<string, CatalogPlan>();
  for (const row of subEnriched.rows) {
    if (!row.contributes_to_mrr) continue;
    const planName = row.plan_name || productNameById.get(row.product_id) || '';
    const key = `${planName}::${row.currency}`;
    const existing = catalogMap.get(key);
    if (existing) {
      existing.monthly_amount += row.monthly_normalized_amount;
      existing.active_count += 1;
    } else {
      catalogMap.set(key, {
        name: planName,
        currency: row.currency,
        monthly_amount: row.monthly_normalized_amount,
        active_count: 1,
      });
    }
  }
  if (catalogMap.size > 0) {
    layer1.catalog = Array.from(catalogMap.values()).sort(
      (a, b) => b.monthly_amount - a.monthly_amount
    );
  }

  // ── 3. scale ──────────────────────────────────────────────────────────────
  // mrr — pick the highest-MRR currency (matches M2.3-S2 customer rollup
  // convention for multi-currency merchants).
  const scale: NonNullable<Layer1['scale']> = {};
  if (mrrResult.rows.length > 0) {
    const top = mrrResult.rows.reduce((a, b) => (b.mrr > a.mrr ? b : a));
    scale.mrr_amount = top.mrr;
    scale.mrr_currency = top.currency;
    // Sum subscription counts across all currencies for the L1 scalar.
    // Phase 2C-pre structural fix — gives the LLM the count without
    // requiring a separate tool call when narrating run-rate MRR.
    scale.active_subscription_count = mrrResult.rows.reduce(
      (sum, row) => sum + row.subscription_count,
      0,
    );
  }
  if (customers.length > 0) {
    scale.customer_count = customers.length;
  }
  if (billedRevenue12m.rows.length > 0) {
    const top = billedRevenue12m.rows.reduce((a, b) =>
      b.billed_revenue > a.billed_revenue ? b : a
    );
    scale.annual_revenue_amount = top.billed_revenue;
    scale.annual_revenue_currency = top.currency;
  }
  if (Object.keys(scale).length > 0) layer1.scale = scale;

  // ── 4. geography_mix ──────────────────────────────────────────────────────
  // From chargeEnriched.card_country (BIN-derived, not billing address).
  // Weight by net_collected (post-refund). Top 5.
  const geoWeights = new Map<string, number>();
  for (const row of chEnriched.rows) {
    if (row.status !== 'succeeded') continue;
    if (!row.card_country) continue;
    geoWeights.set(
      row.card_country,
      (geoWeights.get(row.card_country) ?? 0) + row.net_collected
    );
  }
  const geo = topN(geoWeights, 5);
  if (geo.length > 0) layer1.geography_mix = geo;

  // ── 5. payment_method_mix ────────────────────────────────────────────────
  // From raw charges' payment_method_details.type. Weight by amount (minor units;
  // share is ratio-only so unit cancels). Top 5.
  const pmWeights = new Map<string, number>();
  for (const c of charges12m as ChargeForMix[]) {
    if (c.status !== 'succeeded') continue;
    const type = c.payment_method_details?.type;
    if (!type) continue;
    pmWeights.set(type, (pmWeights.get(type) ?? 0) + c.amount);
  }
  const pm = topN(pmWeights, 5);
  if (pm.length > 0) layer1.payment_method_mix = pm;

  // ── 6. currency_mix ──────────────────────────────────────────────────────
  // Currencies the merchant actually transacts in. Weighted by amount in
  // each currency's own minor units (no FX). Top 5.
  const curWeights = new Map<string, number>();
  for (const c of charges12m as ChargeForMix[]) {
    if (c.status !== 'succeeded') continue;
    curWeights.set(c.currency, (curWeights.get(c.currency) ?? 0) + c.amount);
  }
  const cur = topN(curWeights, 5);
  if (cur.length > 0) layer1.currency_mix = cur;

  // ── 7. first_charge_date ─────────────────────────────────────────────────
  // Was previously paired with account_age_days (v2). v3 dropped the latter
  // because account.created in a Stripe App returns the app-authorization
  // timestamp, not the merchant's actual account-open date — so it was
  // structurally wrong for every merchant. first_charge_date is the honest
  // "how established is this business" anchor.
  if (oldestCharge?.created) {
    layer1.first_charge_date = new Date(oldestCharge.created * 1000)
      .toISOString()
      .slice(0, 10);
  }

  // ── Build Layer 2 — wrapped in try/catch so L1 ships regardless ──────────
  // On L2 failure: persist L1 alone with `l2_build_error` marker (NEVER
  // rendered in prompt/UI; pure debug + retry signal). attempt_count carries
  // forward across consecutive failures so trends show up in Vercel logs.
  let layer2: Layer2 | undefined;
  let l2_build_error: Profile['l2_build_error'];
  try {
    layer2 = buildLayer2({
      billedInvoices: billedInvoices12m,
      charges: charges12m as ChargeForMix[],
      chEnrichedRows: chEnriched.rows,
      customers,
      canceledSubs: canceledSubs12m,
      layer1,
      now,
      oneYearAgoTs,
      nowTs,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const prevAttempts = previousProfile?.l2_build_error?.attempt_count ?? 0;
    l2_build_error = {
      at: now.toISOString(),
      reason,
      attempt_count: prevAttempts + 1,
    };
    // eslint-disable-next-line no-console
    console.error('[profile] L2 build failed', {
      mode,
      reason,
      attempt_count: l2_build_error.attempt_count,
    });
  }

  // ── Assemble Profile envelope ─────────────────────────────────────────────
  return {
    version: PROFILE_SCHEMA_VERSION,
    mode,
    layer1,
    ...(layer2 ? { layer2 } : {}),
    ...(l2_build_error ? { l2_build_error } : {}),
  };
}

// ── Stripe client adapter — wires the deps to a real Stripe client ──────────
//
// Frontend calls this with a Stripe client created from STRIPE_API_KEY +
// the Stripe App http_client. Backend (Phase 2) will call with its own
// per-merchant Stripe client.

// Generic over the Stripe-client type `S`. The backend doesn't depend on the
// `stripe` SDK package — the frontend (which does) supplies its own
// `Stripe`-typed client and fetcher functions when calling this adapter.
export interface BuildProfileFromStripeInput<S> {
  stripe: S;
  mode: StripeMode;
  now?: Date;
  /** Previously-stored profile (for L2 attempt_count carry-forward). */
  previousProfile?: Profile | null;
  // Frontend passes its real fetchers; this keeps the builder decoupled from
  // the frontend's stripeData.ts module so the backend can wire it later.
  fetchers: {
    getActiveSubscriptions: (s: S) => Promise<Parameters<typeof subscriptionEnriched>[0]['subscriptions']>;
    getCustomers: (s: S) => Promise<Array<unknown>>;
    getProducts?: (s: S) => Promise<Array<{ id: string; name?: string | null }>>;
    getCharges: (s: S, start: number, end: number) => Promise<Parameters<typeof chargeEnriched>[0]['charges']>;
    getBilledInvoices: (s: S, start: number, end: number) => Promise<Parameters<typeof periodBilledRevenue>[0]['invoices']>;
    getConnectedAccounts: (s: S) => Promise<Array<unknown>>;
    getOldestCharge: (s: S) => Promise<{ created: number } | null>;
    getCanceledSubscriptions: (s: S, start: number, end: number) => Promise<CanceledSubscriptionForL2[]>;
  };
}

export function buildProfileFromStripe<S>(
  input: BuildProfileFromStripeInput<S>
): Promise<Profile> {
  const { stripe, mode, now = new Date(), fetchers, previousProfile } = input;
  return buildProfile({
    mode,
    now,
    previousProfile,
    deps: {
      getActiveSubscriptions: () => fetchers.getActiveSubscriptions(stripe),
      getCustomers: () => fetchers.getCustomers(stripe),
      getProducts: fetchers.getProducts ? () => fetchers.getProducts!(stripe) : undefined,
      getCharges: (s, e) => fetchers.getCharges(stripe, s, e),
      getBilledInvoices: (s, e) => fetchers.getBilledInvoices(stripe, s, e),
      getConnectedAccounts: () => fetchers.getConnectedAccounts(stripe),
      getOldestCharge: () => fetchers.getOldestCharge(stripe),
      getCanceledSubscriptions: (s, e) => fetchers.getCanceledSubscriptions(stripe, s, e),
    },
  });
}
