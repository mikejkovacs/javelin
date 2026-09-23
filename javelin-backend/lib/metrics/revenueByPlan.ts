// revenue_by_plan — period-collected revenue grouped by subscription plan name.
//
// Spec: Build plan/metric-definitions.md L420–L423.
//
// Definition tag: `javelin_defined.revenue_by_plan`. No Stripe canonical for
// "revenue grouped by plan" as a single metric.
//
// Plan name resolution: `price.nickname ?? product.name ?? 'unattributed'`.
// Charges with no invoice (one-time direct charges) bucket as 'unattributed'.
// Multi-line invoices (rare — typically prorations or upgrades) attribute the
// entire charge to the FIRST line's plan name; documented limitation. Splitting
// proportionally would be more accurate but adds complexity around negative
// line amounts and credit notes that isn't worth it for beta.
//
// Single-currency primitive (M2.3 precedent from customer_concentration): the
// tool wrapper passes `account.default_currency` as the target. Multi-currency
// merchants get the dominant-currency view; documented limitation.
//
// Phase 2C — series mode: when `granularity` is provided ('day'|'week'|'month'),
// the primitive emits a per-plan time series with dense zero-fill across the
// period. See `bucketing.ts` for bucket conventions and the `RevenueByPlanSeriesResult`
// shape below.
//
// Phase 2C-post — plan attribution fix: resolution now follows
// `price.nickname` → `productById[price.product as string]?.name` →
// 'unattributed'. Closes the production gap surfaced 2026-05-09 on Modern
// Cents validation where merchants who don't set Stripe-side price nicknames
// got every charge attributed as 'unattributed'. See PCL entry "Phase 2C
// Merchant A production validation — four findings."

import type { StripeChargeLike } from './chargeEnriched';
import type { StripeInvoiceLike } from './invoiceEnriched';
import type { Period } from './types';
import { toMajor } from './types';
import type { Granularity } from './bucketing';
import { bucketKey, bucketKeysForPeriod } from './bucketing';

/** Minimal Stripe Product shape consumed by revenueByPlan for the
 *  attribution fallback (Phase 2C-post). */
export interface StripeProductLike {
  id: string;
  name: string;
  active: boolean;
}

const UNATTRIBUTED = 'unattributed';

export interface RevenueByPlanRow {
  plan_name: string;
  amount: number;                                  // major units, post-refund
  charge_count: number;
  share: number;                                   // 0..1 of period total
}

export interface RevenueByPlanResult {
  kind: 'rows';
  rows: RevenueByPlanRow[];                        // sorted desc by amount
  unit: 'usd';                                     // overloaded for currency
  currency: string;
  total: number;                                   // denominator, major units
  definition: 'javelin_defined.revenue_by_plan';
  period: Period;
  as_of: number;
}

export interface RevenueByPlanInput {
  charges: StripeChargeLike[];
  invoices: StripeInvoiceLike[];                   // for charge → plan join via charge.invoice
  /** Phase 2C-post — products fetched separately because the Stripe expand-
   *  depth cap blocks `data.lines.data.price.product` (5 segments). Used to
   *  resolve plan name when `price.nickname` is unset and `price.product`
   *  arrives as a string ID. Optional for backwards-compatibility with
   *  call sites that don't pass products yet (resolves to old behavior:
   *  unattributed when nickname unset). */
  products?: StripeProductLike[];
  period: Period;
  currency: string;                                // target currency (account default)
  now: Date;
  /** Phase 2C — when set, returns RevenueByPlanSeriesResult; otherwise rows. */
  granularity?: Granularity;
}

// ── Series shape (Phase 2C) ──────────────────────────────────────────────────

export interface RevenueByPlanSeriesPoint {
  bucket: string;          // 'YYYY-MM-DD' (day/week) or 'YYYY-MM' (month)
  amount: number;          // major units, post-refund; 0 for empty buckets
  charge_count: number;    // 0 for empty buckets
}

export interface RevenueByPlanSeriesGroup {
  plan_name: string;
  total: number;           // major units across all buckets
  charge_count: number;    // total charge count across all buckets
  series: RevenueByPlanSeriesPoint[];   // dense, one point per bucket
}

export interface RevenueByPlanSeriesResult {
  kind: 'series';
  granularity: Granularity;
  buckets: string[];                    // shared bucket keys (aligned across plans)
  plans: RevenueByPlanSeriesGroup[];    // sorted desc by total
  unit: 'usd';                          // overloaded for currency
  currency: string;
  total: number;                        // grand total, major units
  definition: 'javelin_defined.revenue_by_plan';
  period: Period;
  as_of: number;
}

function chargeInvoiceId(charge: StripeChargeLike): string | null {
  return charge.invoice ?? null;
}

function buildProductById(
  products: StripeProductLike[] | undefined,
): Map<string, StripeProductLike> {
  const map = new Map<string, StripeProductLike>();
  if (!products) return map;
  for (const p of products) map.set(p.id, p);
  return map;
}

function inPeriod(charge: StripeChargeLike, period: Period): boolean {
  return charge.created >= period.start && charge.created <= period.end;
}

// SCHEMA GAP — Phase 2C-post Merchant A validation 2026-05-11.
//
// Production diagnostic confirmed Stripe's newer API version restructured
// invoice line items: `line.price` is GONE. The replacement structure puts
// price details under `line.pricing.price_details.*` and the legacy `price`
// field is no longer populated. ALL the resolution paths below short-circuit
// to UNATTRIBUTED on production data because `if (!first.price) return
// UNATTRIBUTED` fires immediately.
//
// Also discovered in the same diagnostic round:
// - `charge.invoice` is null on all production charges for the validated
//   account (no charge→invoice link via this field, regardless of whether
//   the charge was subscription-paid or direct).
// - Invoice top-level `subscription` field moved into `invoice.parent`.
//
// This function is RETAINED AS-IS for fixture compatibility (the fixture
// uses the legacy shape so existing eval cases pass) but it does NOT work
// on production data. Comprehensive fix lands in Phase 2C-post-v2 after
// the Bravo-vs-Charlie design lock (charges-side vs billed-side attribution
// philosophy). See V2 spec Phase 2C-post section + PCL entry 2026-05-11.
function planNameFromInvoice(
  invoice: StripeInvoiceLike | undefined,
  productById: Map<string, StripeProductLike>,
): string {
  if (!invoice) return UNATTRIBUTED;
  const lines = invoice.lines.data;
  if (lines.length === 0) return UNATTRIBUTED;
  const first = lines[0];
  if (!first.price) return UNATTRIBUTED;
  if (first.price.nickname) return first.price.nickname;
  // Phase 2C-post — primary attribution fallback. price.product arrives as a
  // string ID because the Stripe expand-depth cap blocks expansion. Look up
  // the product by ID in the map populated from fetchProducts. NOTE: this
  // path never fires on production data — see SCHEMA GAP block above.
  if (typeof first.price.product === 'string') {
    const product = productById.get(first.price.product);
    if (product?.name) return product.name;
  }
  // Defensive — older call paths might pass an expanded product object.
  if (typeof first.price.product === 'object' && first.price.product.name) {
    return first.price.product.name;
  }
  return UNATTRIBUTED;
}

export function revenueByPlan(
  input: RevenueByPlanInput & { granularity: Granularity },
): RevenueByPlanSeriesResult;
export function revenueByPlan(input: RevenueByPlanInput): RevenueByPlanResult;
export function revenueByPlan(
  input: RevenueByPlanInput,
): RevenueByPlanResult | RevenueByPlanSeriesResult {
  if (input.granularity) {
    return revenueByPlanSeries(
      input as RevenueByPlanInput & { granularity: Granularity },
    );
  }
  return revenueByPlanRows(input);
}

function revenueByPlanRows(input: RevenueByPlanInput): RevenueByPlanResult {
  const { charges, invoices, products, period, currency, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);
  const productById = buildProductById(products);

  // Build invoice lookup map.
  const invoiceById = new Map<string, StripeInvoiceLike>();
  for (const inv of invoices) {
    invoiceById.set(inv.id, inv);
  }

  // Aggregate by plan_name.
  const planAggregates = new Map<string, { amount_minor: number; charge_count: number }>();
  let total_minor = 0;

  for (const charge of charges) {
    if (charge.status !== 'succeeded') continue;
    if (!inPeriod(charge, period)) continue;
    if (charge.currency !== currency) continue;

    const net_minor = charge.amount - charge.amount_refunded;
    if (net_minor <= 0) continue; // fully refunded → skip

    const invoiceId = chargeInvoiceId(charge);
    const invoice = invoiceId != null ? invoiceById.get(invoiceId) : undefined;
    const plan_name = planNameFromInvoice(invoice, productById);

    const existing = planAggregates.get(plan_name) ?? { amount_minor: 0, charge_count: 0 };
    existing.amount_minor += net_minor;
    existing.charge_count += 1;
    planAggregates.set(plan_name, existing);

    total_minor += net_minor;
  }

  const total = toMajor(total_minor, currency);

  const rows: RevenueByPlanRow[] = [];
  for (const [plan_name, agg] of planAggregates) {
    const amount = toMajor(agg.amount_minor, currency);
    rows.push({
      plan_name,
      amount,
      charge_count: agg.charge_count,
      share: total_minor === 0 ? 0 : agg.amount_minor / total_minor,
    });
  }
  rows.sort((a, b) => b.amount - a.amount);

  return {
    kind: 'rows',
    rows,
    unit: 'usd',
    currency,
    total,
    definition: 'javelin_defined.revenue_by_plan',
    period,
    as_of: nowSec,
  };
}

function revenueByPlanSeries(
  input: RevenueByPlanInput & { granularity: Granularity },
): RevenueByPlanSeriesResult {
  const { charges, invoices, products, period, currency, now, granularity } = input;
  const nowSec = Math.floor(now.getTime() / 1000);
  const productById = buildProductById(products);

  const buckets = bucketKeysForPeriod(period, granularity);
  const bucketIndex = new Map<string, number>();
  for (let i = 0; i < buckets.length; i++) {
    bucketIndex.set(buckets[i], i);
  }

  const invoiceById = new Map<string, StripeInvoiceLike>();
  for (const inv of invoices) invoiceById.set(inv.id, inv);

  // plan_name → { totalMinor, totalCount, perBucketMinor[], perBucketCount[] }
  const planState = new Map<
    string,
    {
      total_minor: number;
      total_count: number;
      per_bucket_minor: number[];
      per_bucket_count: number[];
    }
  >();
  let grand_total_minor = 0;

  for (const charge of charges) {
    if (charge.status !== 'succeeded') continue;
    if (!inPeriod(charge, period)) continue;
    if (charge.currency !== currency) continue;

    const net_minor = charge.amount - charge.amount_refunded;
    if (net_minor <= 0) continue;

    const invoiceId = chargeInvoiceId(charge);
    const invoice = invoiceId != null ? invoiceById.get(invoiceId) : undefined;
    const plan_name = planNameFromInvoice(invoice, productById);

    const key = bucketKey(charge.created, granularity);
    const idx = bucketIndex.get(key);
    if (idx === undefined) continue;     // defensive — out of pre-built range

    let state = planState.get(plan_name);
    if (!state) {
      state = {
        total_minor: 0,
        total_count: 0,
        per_bucket_minor: new Array(buckets.length).fill(0),
        per_bucket_count: new Array(buckets.length).fill(0),
      };
      planState.set(plan_name, state);
    }
    state.total_minor += net_minor;
    state.total_count += 1;
    state.per_bucket_minor[idx] += net_minor;
    state.per_bucket_count[idx] += 1;

    grand_total_minor += net_minor;
  }

  const plans: RevenueByPlanSeriesGroup[] = [];
  for (const [plan_name, state] of planState) {
    const series: RevenueByPlanSeriesPoint[] = buckets.map((bucket, i) => ({
      bucket,
      amount: toMajor(state.per_bucket_minor[i], currency),
      charge_count: state.per_bucket_count[i],
    }));
    plans.push({
      plan_name,
      total: toMajor(state.total_minor, currency),
      charge_count: state.total_count,
      series,
    });
  }
  plans.sort((a, b) => b.total - a.total);

  return {
    kind: 'series',
    granularity,
    buckets,
    plans,
    unit: 'usd',
    currency,
    total: toMajor(grand_total_minor, currency),
    definition: 'javelin_defined.revenue_by_plan',
    period,
    as_of: nowSec,
  };
}
