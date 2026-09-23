// customer_spend_distribution — distribution stats over per-customer total
// spend in a date period. Self-defined (`javelin_defined.customer_spend_distribution`)
// — Stripe Sigma's `customers` table supports SQL MEDIAN/PERCENTILE, but no
// public Stripe surface exposes these aggregates.
//
// Definition: of customers who had at least one succeeded charge in the
// period in the merchant's default currency, the distribution of per-customer
// total net_collected. Customers with zero charges in the period are
// EXCLUDED from the denominator — answering "of my paying customers, what's
// typical."
//
// Median: strict middle. Odd n → middle element. Even n → average of two
// middles. Percentiles (p25, p75, p90): nearest-rank method.
// `low_sample: true` when paying_customer_count < 5 — disclose explicitly per
// tool description.

import type { ChargeEnrichedRow } from './chargeEnriched';
import type { Period } from './types';

// ── Output shape ──────────────────────────────────────────────────────────────

export interface CustomerSpendDistributionValue {
  median: number | null;       // major units
  p25: number | null;
  p75: number | null;
  p90: number | null;
  mean: number | null;
  paying_customer_count: number;
  total_collected: number;     // sum across paying customers in period
  top_1_share: number;         // 0..1
  bottom_50_share: number;     // 0..1
  low_sample: boolean;         // true when paying_customer_count < 5
}

export interface CustomerSpendDistributionResult {
  kind: 'scalar';
  value: CustomerSpendDistributionValue;
  unit: 'percent';
  definition: 'javelin_defined.customer_spend_distribution';
  currency: string;
  period: Period;
  as_of: number;
}

export interface CustomerSpendDistributionInput {
  charges: ChargeEnrichedRow[];
  period: Period;
  default_currency: string;
  now: Date;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strict-middle median over a pre-sorted-ascending array. Empty → null. */
function strictMiddleMedian(sorted: number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Nearest-rank percentile over a pre-sorted-ascending array. Empty → null.
 *  p in [0, 100]. Uses 1-indexed rank = ceil(p/100 * n), then -1 to index. */
function nearestRankPercentile(sorted: number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[n - 1];
  const rank = Math.ceil((p / 100) * n);
  return sorted[Math.max(0, rank - 1)];
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function customerSpendDistribution(
  input: CustomerSpendDistributionInput,
): CustomerSpendDistributionResult {
  const { charges, period, default_currency, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);
  const currency = default_currency.toLowerCase();

  // Aggregate per customer: succeeded charges in period, in default_currency.
  const totalsByCustomer = new Map<string, number>();
  for (const ch of charges) {
    if (ch.status !== 'succeeded') continue;
    if (ch.currency !== currency) continue;
    if (ch.customer_id == null) continue;
    if (ch.created_at < period.start || ch.created_at > period.end) continue;
    const prev = totalsByCustomer.get(ch.customer_id) ?? 0;
    totalsByCustomer.set(ch.customer_id, prev + ch.net_collected);
  }

  const totals = Array.from(totalsByCustomer.values())
    .filter((v) => v > 0) // exclude customers whose period total is zero or negative
    .sort((a, b) => a - b);

  const paying_customer_count = totals.length;
  const total_collected = totals.reduce((acc, v) => acc + v, 0);

  const median = strictMiddleMedian(totals);
  const p25 = nearestRankPercentile(totals, 25);
  const p75 = nearestRankPercentile(totals, 75);
  const p90 = nearestRankPercentile(totals, 90);
  const mean =
    paying_customer_count > 0 ? total_collected / paying_customer_count : null;

  // Concentration framing fields.
  const top_1_share =
    total_collected > 0 ? totals[totals.length - 1] / total_collected : 0;
  const bottom_50_count = Math.floor(paying_customer_count / 2);
  const bottom_50_sum = totals
    .slice(0, bottom_50_count)
    .reduce((acc, v) => acc + v, 0);
  const bottom_50_share =
    total_collected > 0 ? bottom_50_sum / total_collected : 0;

  return {
    kind: 'scalar',
    value: {
      median,
      p25,
      p75,
      p90,
      mean,
      paying_customer_count,
      total_collected,
      top_1_share,
      bottom_50_share,
      low_sample: paying_customer_count < 5,
    },
    unit: 'percent',
    definition: 'javelin_defined.customer_spend_distribution',
    currency,
    period,
    as_of: nowSec,
  };
}
