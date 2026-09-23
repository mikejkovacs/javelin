// period_collected_revenue — sum of (amount − amount_refunded) for succeeded
// charges in [period.start, period.end], per currency.
// Spec: Build plan/metric-definitions.md L296–L304.
//
// Derived from charge_enriched: same row shape, no re-implementation.

import { chargeEnriched, type StripeChargeLike, type StripeBalanceTransactionLike } from './chargeEnriched';
import type { Period } from './types';

export interface PeriodCollectedRevenueRow {
  currency: string;
  collected_revenue: number;
  charge_count: number;
  /** Sum of (amount − amount_refunded), in major units, for charges that
   *  were excluded by exclude_fraud=true. 0 when filter is off. */
  fraud_excluded: number;
}

export interface PeriodCollectedRevenueResult {
  kind: 'rows';
  rows: PeriodCollectedRevenueRow[];
  definition: 'javelin_derived.period_collected_revenue';
  as_of: number;
  period: Period;
}

export interface PeriodCollectedRevenueInput {
  charges: StripeChargeLike[];
  // BTs are not used for this metric but kept in the input shape so the
  // bundler can pass the same { charges, balanceTransactions, now } payload
  // to every charge-derived metric.
  balanceTransactions: StripeBalanceTransactionLike[];
  period: Period;
  now: Date;
  /** When true, charges flagged fraudulent (fraud_details.user_report or
   *  stripe_report = 'fraudulent') are excluded. Per-currency
   *  `fraud_excluded` reports the dollar volume removed. M2 Phase 2A. */
  excludeFraud?: boolean;
}

export function periodCollectedRevenue(
  input: PeriodCollectedRevenueInput
): PeriodCollectedRevenueResult {
  const { charges, balanceTransactions, period, now, excludeFraud = false } = input;
  const enriched = chargeEnriched({ charges, balanceTransactions, now });

  type Bucket = { collected_revenue: number; charge_count: number; fraud_excluded: number };
  const buckets = new Map<string, Bucket>();
  for (const row of enriched.rows) {
    if (row.status !== 'succeeded') continue;
    if (row.created_at < period.start || row.created_at > period.end) continue;
    const bucket = buckets.get(row.currency) ?? {
      collected_revenue: 0,
      charge_count: 0,
      fraud_excluded: 0,
    };
    const net_collected = row.amount - row.amount_refunded;
    if (excludeFraud && row.is_fraudulent) {
      bucket.fraud_excluded += net_collected;
    } else {
      bucket.collected_revenue += net_collected;
      bucket.charge_count += 1;
    }
    buckets.set(row.currency, bucket);
  }

  const rows = Array.from(buckets.entries())
    .map(([currency, b]) => ({ currency, ...b }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    kind: 'rows',
    rows,
    definition: 'javelin_derived.period_collected_revenue',
    as_of: enriched.as_of,
    period,
  };
}
