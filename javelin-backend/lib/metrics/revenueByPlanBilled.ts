// revenue_by_plan_billed — period-BILLED revenue grouped by plan name.
//
// Phase 2C-post-v2 (Option Charlie, locked 2026-05-12). Sibling to existing
// `revenue_by_plan` (charges/collected side); this tool answers the
// "what was BILLED per plan" question that the charges-side tool can't
// answer when charge.invoice links are missing (Merchant A production
// validation 2026-05-11). Mirrors the period_collected_revenue +
// period_billed_revenue pair pattern at the per-plan grain.
//
// Definition tag: `javelin_defined.revenue_by_plan_billed`. No Stripe
// canonical for "billed revenue grouped by plan" as a single metric.
//
// Scope (matches period_billed_revenue's invoice filter):
//   - Status in {paid, open, uncollectible}. Voided + draft excluded.
//   - Finalized within the period (`status_transitions.finalized_at` if
//     present, else falls back to `invoice.created`).
//
// Plan-name resolution (dual-shape defensive reading — Phase 2C-post-v2 S2=C):
//   1. NEW SHAPE (Stripe 2024-2025 API): `line.pricing.price_details.product`
//      → look up in `productById` map → return `product.name`.
//   2. LEGACY SHAPE: `line.price.nickname` if set, else
//      `line.price.product` (string ID lookup or expanded object's `.name`).
//   3. Fall through to 'unattributed' when neither shape resolves.
//
// Aggregation: PER LINE within each invoice, summed across invoices. Each
// line.amount is attributed to ITS OWN plan (no first-line-wins shortcut
// like the charges-side tool). Multi-line invoices (prorations, mixed plans)
// split correctly across plans.
//
// Multi-currency (mirrors period_billed_revenue + revenue_by_country):
//   - Rows are keyed by (plan_name, currency) tuple.
//   - Per-currency totals retained; no cross-currency sums (CRITICAL RULE #8).
//   - Sort: dominant-currency block first, then by amount desc within block.
//
// Series mode (Phase 2C-post-v2 S1=A): when `granularity` is set, emits a
// per-plan time series with dense zero-fill matching `revenue_by_plan`'s
// pattern. Same bucket caps (90/52/36 day/week/month).

import type { StripeInvoiceLike, StripeInvoiceLineItemLike } from './invoiceEnriched';
import type { Period, TableMetadata } from './types';
import { toMajor } from './types';
import type { StripeProductLike } from './revenueByPlan';
import type { Granularity } from './bucketing';
import { bucketKey, bucketKeysForPeriod } from './bucketing';

const UNATTRIBUTED = 'unattributed';

// ── Rows shape (default) ─────────────────────────────────────────────────────

export interface RevenueByPlanBilledRow {
  plan_name: string;
  currency: string;         // lowercase ISO
  amount: number;           // major units, summed line.amount
  invoice_count: number;    // number of distinct invoices contributing
  line_count: number;       // number of lines contributing (>= invoice_count)
  share: number;            // 0..1 of THIS currency's total
}

export interface RevenueByPlanBilledResult {
  kind: 'rows';
  rows: RevenueByPlanBilledRow[];
  totals_by_currency: { [currency: string]: number };
  table: TableMetadata;
  definition: 'javelin_defined.revenue_by_plan_billed';
  period: Period;
  as_of: number;
}

const REVENUE_BY_PLAN_BILLED_TABLE: TableMetadata = {
  columns: [
    { field: 'plan_name', label: 'Plan', align: 'left' },
    { field: 'currency', label: 'Currency', align: 'left' },
    {
      field: 'amount',
      label: 'Billed',
      align: 'right',
      format: 'currency',
      currency_field: 'currency',
    },
    { field: 'invoice_count', label: 'Invoices', align: 'right', format: 'number' },
    { field: 'share', label: 'Share', align: 'right', format: 'percent' },
  ],
  sort_default: { field: 'amount', order: 'desc' },
  empty_label: 'No billed plan revenue in this period',
};

// ── Series shape ─────────────────────────────────────────────────────────────

export interface RevenueByPlanBilledSeriesPoint {
  bucket: string;
  amount: number;
  invoice_count: number;
  line_count: number;
}

export interface RevenueByPlanBilledSeriesGroup {
  plan_name: string;
  currency: string;
  total: number;
  invoice_count: number;
  line_count: number;
  series: RevenueByPlanBilledSeriesPoint[];
}

export interface RevenueByPlanBilledSeriesResult {
  kind: 'series';
  granularity: Granularity;
  buckets: string[];
  groups: RevenueByPlanBilledSeriesGroup[];
  totals_by_currency: { [currency: string]: number };
  definition: 'javelin_defined.revenue_by_plan_billed';
  period: Period;
  as_of: number;
}

// ── Input ────────────────────────────────────────────────────────────────────

export interface RevenueByPlanBilledInput {
  invoices: StripeInvoiceLike[];
  /** For plan-name resolution when nickname is null and product comes through
   *  as a string ID (either legacy or new shape — both produce string IDs). */
  products?: StripeProductLike[];
  period: Period;
  now: Date;
  granularity?: Granularity;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildProductById(
  products: StripeProductLike[] | undefined,
): Map<string, StripeProductLike> {
  const map = new Map<string, StripeProductLike>();
  if (!products) return map;
  for (const p of products) map.set(p.id, p);
  return map;
}

/** Returns the effective finalization time for the invoice, falling back to
 *  `created` when status_transitions is absent or finalized_at is null. */
function invoiceFinalizedAt(invoice: StripeInvoiceLike): number {
  return invoice.status_transitions?.finalized_at ?? invoice.created;
}

/** Dual-shape plan-name resolution. Returns the plan name string, or
 *  'unattributed' when neither shape carries a usable label. */
function planNameFromLine(
  line: StripeInvoiceLineItemLike,
  productById: Map<string, StripeProductLike>,
): string {
  // 1. NEW SHAPE — pricing.price_details.product (string ID)
  const newProductId = line.pricing?.price_details?.product;
  if (typeof newProductId === 'string' && newProductId) {
    const product = productById.get(newProductId);
    if (product?.name) return product.name;
  }
  // 2. LEGACY SHAPE — line.price.nickname is the merchant-set label
  if (line.price?.nickname) return line.price.nickname;
  // 3. LEGACY SHAPE — line.price.product (string ID lookup)
  if (typeof line.price?.product === 'string' && line.price.product) {
    const product = productById.get(line.price.product);
    if (product?.name) return product.name;
  }
  // 4. LEGACY SHAPE — line.price.product expanded object
  if (
    line.price?.product &&
    typeof line.price.product === 'object' &&
    line.price.product.name
  ) {
    return line.price.product.name;
  }
  return UNATTRIBUTED;
}

const COUNTED_INVOICE_STATUSES: ReadonlySet<string> = new Set([
  'paid',
  'open',
  'uncollectible',
]);

function inPeriod(invoice: StripeInvoiceLike, period: Period): boolean {
  const t = invoiceFinalizedAt(invoice);
  return t >= period.start && t <= period.end;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function revenueByPlanBilled(
  input: RevenueByPlanBilledInput & { granularity: Granularity },
): RevenueByPlanBilledSeriesResult;
export function revenueByPlanBilled(
  input: RevenueByPlanBilledInput,
): RevenueByPlanBilledResult;
export function revenueByPlanBilled(
  input: RevenueByPlanBilledInput,
): RevenueByPlanBilledResult | RevenueByPlanBilledSeriesResult {
  if (input.granularity) {
    return revenueByPlanBilledSeries(
      input as RevenueByPlanBilledInput & { granularity: Granularity },
    );
  }
  return revenueByPlanBilledRows(input);
}

function revenueByPlanBilledRows(
  input: RevenueByPlanBilledInput,
): RevenueByPlanBilledResult {
  const { invoices, products, period, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);
  const productById = buildProductById(products);

  // (plan_name, currency) → aggregate
  const tupleAggregates = new Map<
    string,
    {
      plan_name: string;
      currency: string;
      amount_minor: number;
      invoice_ids: Set<string>;
      line_count: number;
    }
  >();
  const currencyTotalMinor = new Map<string, number>();

  for (const invoice of invoices) {
    if (!invoice.status || !COUNTED_INVOICE_STATUSES.has(invoice.status)) continue;
    if (!inPeriod(invoice, period)) continue;

    for (const line of invoice.lines.data) {
      // Line amount in minor units. Default to 0 if absent; lines without
      // explicit amount can't be attributed (rare — typically Stripe
      // populates this on every chargeable line).
      const amount_minor = line.amount ?? 0;
      if (amount_minor <= 0) continue;        // skip non-positive line amounts

      const plan_name = planNameFromLine(line, productById);
      // Per-line currency override (rare); default to invoice.currency.
      const currency = line.currency ?? invoice.currency;
      const tupleKey = `${plan_name}|${currency}`;

      const existing = tupleAggregates.get(tupleKey);
      if (existing) {
        existing.amount_minor += amount_minor;
        existing.invoice_ids.add(invoice.id);
        existing.line_count += 1;
      } else {
        tupleAggregates.set(tupleKey, {
          plan_name,
          currency,
          amount_minor,
          invoice_ids: new Set([invoice.id]),
          line_count: 1,
        });
      }
      currencyTotalMinor.set(
        currency,
        (currencyTotalMinor.get(currency) ?? 0) + amount_minor,
      );
    }
  }

  // Build rows with per-currency share.
  const rows: RevenueByPlanBilledRow[] = [];
  for (const agg of tupleAggregates.values()) {
    const currencyTotal = currencyTotalMinor.get(agg.currency) ?? 0;
    rows.push({
      plan_name: agg.plan_name,
      currency: agg.currency,
      amount: toMajor(agg.amount_minor, agg.currency),
      invoice_count: agg.invoice_ids.size,
      line_count: agg.line_count,
      share: currencyTotal === 0 ? 0 : agg.amount_minor / currencyTotal,
    });
  }
  // Sort: dominant-currency block first (by minor-unit total), then by amount
  // desc within each currency.
  rows.sort((a, b) => {
    const aT = currencyTotalMinor.get(a.currency) ?? 0;
    const bT = currencyTotalMinor.get(b.currency) ?? 0;
    if (aT !== bT) return bT - aT;
    return b.amount - a.amount;
  });

  const totals_by_currency: { [currency: string]: number } = {};
  for (const [currency, totalMinor] of currencyTotalMinor) {
    totals_by_currency[currency] = toMajor(totalMinor, currency);
  }

  return {
    kind: 'rows',
    rows,
    totals_by_currency,
    table: REVENUE_BY_PLAN_BILLED_TABLE,
    definition: 'javelin_defined.revenue_by_plan_billed',
    period,
    as_of: nowSec,
  };
}

function revenueByPlanBilledSeries(
  input: RevenueByPlanBilledInput & { granularity: Granularity },
): RevenueByPlanBilledSeriesResult {
  const { invoices, products, period, now, granularity } = input;
  const nowSec = Math.floor(now.getTime() / 1000);
  const productById = buildProductById(products);

  const buckets = bucketKeysForPeriod(period, granularity);
  const bucketIndex = new Map<string, number>();
  for (let i = 0; i < buckets.length; i++) bucketIndex.set(buckets[i], i);

  // (plan_name, currency) → series state
  const groupState = new Map<
    string,
    {
      plan_name: string;
      currency: string;
      total_minor: number;
      invoice_ids: Set<string>;
      line_count: number;
      per_bucket_minor: number[];
      per_bucket_invoice_ids: Set<string>[];
      per_bucket_line_count: number[];
    }
  >();
  const currencyTotalMinor = new Map<string, number>();

  for (const invoice of invoices) {
    if (!invoice.status || !COUNTED_INVOICE_STATUSES.has(invoice.status)) continue;
    if (!inPeriod(invoice, period)) continue;

    const finalized = invoiceFinalizedAt(invoice);
    const key = bucketKey(finalized, granularity);
    const idx = bucketIndex.get(key);
    if (idx === undefined) continue;

    for (const line of invoice.lines.data) {
      const amount_minor = line.amount ?? 0;
      if (amount_minor <= 0) continue;

      const plan_name = planNameFromLine(line, productById);
      const currency = line.currency ?? invoice.currency;
      const tupleKey = `${plan_name}|${currency}`;

      let state = groupState.get(tupleKey);
      if (!state) {
        state = {
          plan_name,
          currency,
          total_minor: 0,
          invoice_ids: new Set(),
          line_count: 0,
          per_bucket_minor: new Array(buckets.length).fill(0),
          per_bucket_invoice_ids: Array.from(
            { length: buckets.length },
            () => new Set<string>(),
          ),
          per_bucket_line_count: new Array(buckets.length).fill(0),
        };
        groupState.set(tupleKey, state);
      }
      state.total_minor += amount_minor;
      state.invoice_ids.add(invoice.id);
      state.line_count += 1;
      state.per_bucket_minor[idx] += amount_minor;
      state.per_bucket_invoice_ids[idx].add(invoice.id);
      state.per_bucket_line_count[idx] += 1;

      currencyTotalMinor.set(
        currency,
        (currencyTotalMinor.get(currency) ?? 0) + amount_minor,
      );
    }
  }

  const groups: RevenueByPlanBilledSeriesGroup[] = [];
  for (const state of groupState.values()) {
    const series: RevenueByPlanBilledSeriesPoint[] = buckets.map((bucket, i) => ({
      bucket,
      amount: toMajor(state.per_bucket_minor[i], state.currency),
      invoice_count: state.per_bucket_invoice_ids[i].size,
      line_count: state.per_bucket_line_count[i],
    }));
    groups.push({
      plan_name: state.plan_name,
      currency: state.currency,
      total: toMajor(state.total_minor, state.currency),
      invoice_count: state.invoice_ids.size,
      line_count: state.line_count,
      series,
    });
  }
  groups.sort((a, b) => {
    const aT = currencyTotalMinor.get(a.currency) ?? 0;
    const bT = currencyTotalMinor.get(b.currency) ?? 0;
    if (aT !== bT) return bT - aT;
    return b.total - a.total;
  });

  const totals_by_currency: { [currency: string]: number } = {};
  for (const [currency, totalMinor] of currencyTotalMinor) {
    totals_by_currency[currency] = toMajor(totalMinor, currency);
  }

  return {
    kind: 'series',
    granularity,
    buckets,
    groups,
    totals_by_currency,
    definition: 'javelin_defined.revenue_by_plan_billed',
    period,
    as_of: nowSec,
  };
}
