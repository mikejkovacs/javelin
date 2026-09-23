// revenue_by_country — period-collected revenue grouped by (country, currency).
//
// Definition tag: `javelin_defined.revenue_by_country`. No Stripe canonical
// for "revenue grouped by country" as a single metric; this mirrors the L1
// profile's `geography_mix` definition (card-issuing country, BIN-derived).
//
// Country resolution: `payment_method_details.card.country` (alpha-2 ISO).
// Charges with null card-country bucket as `country: 'unknown'`. Same source
// as the L1 profile so the merchant sees one geography view across the
// product (decision locked 2026-04-30 per Chunks A–D / 7B research pass;
// reaffirmed Phase 2C design lock 2026-05-09 — see Q5 in M2 scope memory).
// This is a PROXY for buyer location: a US customer paying with a UK-issued
// card appears under 'GB'. Tool description carries this attribution note
// so the LLM can disclose it in answers when relevant.
//
// Multi-currency: rows carry their own currency (no FX conversion). A
// Canadian merchant with US and UK customers gets parallel sub-breakdowns
// per currency. Cross-currency totals are intentionally NOT computed —
// see CRITICAL RULE #8 (don't sum across currencies). The shape diverges
// from `revenueByPlan` (which is single-currency by account default) — see
// 7B design notes for rationale.
//
// Phase 2C — series mode: when `granularity` is provided ('day'|'week'|'month'),
// the primitive emits a per-(country, currency) time series with dense
// zero-fill across the period. See `bucketing.ts` and the series shape below.

import type { StripeChargeLike } from './chargeEnriched';
import type { Period, TableMetadata } from './types';
import { toMajor } from './types';
import type { Granularity } from './bucketing';
import { bucketKey, bucketKeysForPeriod } from './bucketing';

const UNKNOWN_COUNTRY = 'unknown';

export interface RevenueByCountryRow {
  country: string;          // ISO alpha-2 ("US", "CA", "GB") or "unknown"
  currency: string;          // lowercase ISO ("usd", "cad", "gbp")
  amount: number;            // major units, post-refund
  charge_count: number;
  share: number;             // 0..1 — share of THIS currency's total
}

export interface RevenueByCountryResult {
  kind: 'rows';
  rows: RevenueByCountryRow[];
  // Sort: dominant-currency block first (by total amount within currency,
  // expressed in minor units for stable comparison), then desc by amount
  // within each currency block.
  totals_by_currency: { [currency: string]: number }; // major units
  /** 3B table metadata — frontend renders rows as a Stripe Apps SDK Table
   *  when this block is present. Retro target for the 3B/Chunk C ship. */
  table: TableMetadata;
  definition: 'javelin_defined.revenue_by_country';
  period: Period;
  as_of: number;
}

const REVENUE_BY_COUNTRY_TABLE: TableMetadata = {
  columns: [
    { field: 'country', label: 'Country', align: 'left' },
    { field: 'currency', label: 'Currency', align: 'left' },
    {
      field: 'amount',
      label: 'Revenue',
      align: 'right',
      format: 'currency',
      currency_field: 'currency',
    },
    { field: 'charge_count', label: 'Charges', align: 'right', format: 'number' },
    { field: 'share', label: 'Share', align: 'right', format: 'percent' },
  ],
  sort_default: { field: 'amount', order: 'desc' },
  empty_label: 'No charges in this period',
};

export interface RevenueByCountryInput {
  charges: StripeChargeLike[];
  period: Period;
  now: Date;
  /** Phase 2C — when set, returns RevenueByCountrySeriesResult; otherwise rows. */
  granularity?: Granularity;
}

// ── Series shape (Phase 2C) ──────────────────────────────────────────────────

export interface RevenueByCountrySeriesPoint {
  bucket: string;          // 'YYYY-MM-DD' (day/week) or 'YYYY-MM' (month)
  amount: number;          // major units, post-refund; 0 for empty buckets
  charge_count: number;    // 0 for empty buckets
}

export interface RevenueByCountrySeriesGroup {
  country: string;         // ISO alpha-2 or 'unknown'
  currency: string;        // lowercase ISO
  total: number;           // major units, all buckets
  charge_count: number;    // total across all buckets
  series: RevenueByCountrySeriesPoint[];   // dense, one point per bucket
}

export interface RevenueByCountrySeriesResult {
  kind: 'series';
  granularity: Granularity;
  buckets: string[];
  // Sorted: dominant-currency block first (by minor-unit total), then by
  // group total desc within currency block.
  groups: RevenueByCountrySeriesGroup[];
  totals_by_currency: { [currency: string]: number };
  definition: 'javelin_defined.revenue_by_country';
  period: Period;
  as_of: number;
}

function inPeriod(charge: StripeChargeLike, period: Period): boolean {
  return charge.created >= period.start && charge.created <= period.end;
}

function countryFromCharge(charge: StripeChargeLike): string {
  return charge.payment_method_details?.card?.country ?? UNKNOWN_COUNTRY;
}

export function revenueByCountry(
  input: RevenueByCountryInput & { granularity: Granularity },
): RevenueByCountrySeriesResult;
export function revenueByCountry(
  input: RevenueByCountryInput,
): RevenueByCountryResult;
export function revenueByCountry(
  input: RevenueByCountryInput,
): RevenueByCountryResult | RevenueByCountrySeriesResult {
  if (input.granularity) {
    return revenueByCountrySeries(
      input as RevenueByCountryInput & { granularity: Granularity },
    );
  }
  return revenueByCountryRows(input);
}

function revenueByCountryRows(
  input: RevenueByCountryInput,
): RevenueByCountryResult {
  const { charges, period, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  // Aggregate by (country, currency) tuple, keyed as `country|currency`.
  const tupleAggregates = new Map<
    string,
    { country: string; currency: string; amount_minor: number; charge_count: number }
  >();
  // Per-currency totals (minor units) for sort + share computation + output.
  const currencyTotals = new Map<string, number>();

  for (const charge of charges) {
    if (charge.status !== 'succeeded') continue;
    if (!inPeriod(charge, period)) continue;

    const net_minor = charge.amount - charge.amount_refunded;
    if (net_minor <= 0) continue;

    const country = countryFromCharge(charge);
    const currency = charge.currency;
    const tupleKey = `${country}|${currency}`;

    const existing = tupleAggregates.get(tupleKey) ?? {
      country,
      currency,
      amount_minor: 0,
      charge_count: 0,
    };
    existing.amount_minor += net_minor;
    existing.charge_count += 1;
    tupleAggregates.set(tupleKey, existing);

    currencyTotals.set(
      currency,
      (currencyTotals.get(currency) ?? 0) + net_minor,
    );
  }

  // Build rows. Share is per-currency (cross-currency share isn't computable
  // without FX, which we don't do).
  const rows: RevenueByCountryRow[] = [];
  for (const agg of tupleAggregates.values()) {
    const currencyTotal = currencyTotals.get(agg.currency) ?? 0;
    rows.push({
      country: agg.country,
      currency: agg.currency,
      amount: toMajor(agg.amount_minor, agg.currency),
      charge_count: agg.charge_count,
      share: currencyTotal === 0 ? 0 : agg.amount_minor / currencyTotal,
    });
  }

  // Sort: dominant currency first (by minor-unit total, stable across currencies
  // because we just compare numerically — a CAD merchant's CAD total is bigger
  // than a UK customer's GBP within the same fixture), then by amount desc
  // within the same currency.
  rows.sort((a, b) => {
    const aCurrencyTotal = currencyTotals.get(a.currency) ?? 0;
    const bCurrencyTotal = currencyTotals.get(b.currency) ?? 0;
    if (aCurrencyTotal !== bCurrencyTotal) {
      return bCurrencyTotal - aCurrencyTotal;
    }
    // Same currency block — sort by amount desc.
    return b.amount - a.amount;
  });

  // Build totals_by_currency in major units.
  const totals_by_currency: { [currency: string]: number } = {};
  for (const [currency, totalMinor] of currencyTotals) {
    totals_by_currency[currency] = toMajor(totalMinor, currency);
  }

  return {
    kind: 'rows',
    rows,
    totals_by_currency,
    table: REVENUE_BY_COUNTRY_TABLE,
    definition: 'javelin_defined.revenue_by_country',
    period,
    as_of: nowSec,
  };
}

function revenueByCountrySeries(
  input: RevenueByCountryInput & { granularity: Granularity },
): RevenueByCountrySeriesResult {
  const { charges, period, now, granularity } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  const buckets = bucketKeysForPeriod(period, granularity);
  const bucketIndex = new Map<string, number>();
  for (let i = 0; i < buckets.length; i++) bucketIndex.set(buckets[i], i);

  // (country|currency) → group state.
  const groupState = new Map<
    string,
    {
      country: string;
      currency: string;
      total_minor: number;
      total_count: number;
      per_bucket_minor: number[];
      per_bucket_count: number[];
    }
  >();
  // Per-currency minor totals for sort priority.
  const currencyTotalMinor = new Map<string, number>();

  for (const charge of charges) {
    if (charge.status !== 'succeeded') continue;
    if (charge.created < period.start || charge.created > period.end) continue;

    const net_minor = charge.amount - charge.amount_refunded;
    if (net_minor <= 0) continue;

    const country = countryFromCharge(charge);
    const currency = charge.currency;
    const tupleKey = `${country}|${currency}`;

    const key = bucketKey(charge.created, granularity);
    const idx = bucketIndex.get(key);
    if (idx === undefined) continue;

    let state = groupState.get(tupleKey);
    if (!state) {
      state = {
        country,
        currency,
        total_minor: 0,
        total_count: 0,
        per_bucket_minor: new Array(buckets.length).fill(0),
        per_bucket_count: new Array(buckets.length).fill(0),
      };
      groupState.set(tupleKey, state);
    }
    state.total_minor += net_minor;
    state.total_count += 1;
    state.per_bucket_minor[idx] += net_minor;
    state.per_bucket_count[idx] += 1;

    currencyTotalMinor.set(
      currency,
      (currencyTotalMinor.get(currency) ?? 0) + net_minor,
    );
  }

  const groups: RevenueByCountrySeriesGroup[] = [];
  for (const state of groupState.values()) {
    const series: RevenueByCountrySeriesPoint[] = buckets.map((bucket, i) => ({
      bucket,
      amount: toMajor(state.per_bucket_minor[i], state.currency),
      charge_count: state.per_bucket_count[i],
    }));
    groups.push({
      country: state.country,
      currency: state.currency,
      total: toMajor(state.total_minor, state.currency),
      charge_count: state.total_count,
      series,
    });
  }
  // Same sort as rows mode: dominant currency first (by minor-unit total),
  // then by group total desc within currency block.
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
    definition: 'javelin_defined.revenue_by_country',
    period,
    as_of: nowSec,
  };
}
