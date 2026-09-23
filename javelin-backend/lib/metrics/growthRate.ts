// growth_rate — trailing-N-month growth rate series for a revenue metric.
//
// Definition tag: `javelin_defined.growth_rate`. Stripe canonical for the
// formula (period-over-period delta) per Stripe SaaS metrics guide:
// "MRR is used to measure a business's growth rate, which is calculated
// by comparing the MRR from one period to another."
// (https://stripe.com/resources/more/essential-saas-metrics)
// Window default (6 months), trend-label thresholds (5pp), and trend-label
// taxonomy (accelerating / decelerating / declining / flat) are
// Javelin-defined — Stripe does not publish a canonical default.
//
// Sources from L2 profile envelope (refreshed every ~7 days). The 7-day
// staleness is invisible at monthly aggregation grain; the tool description
// notes this so the LLM can be honest if the user asks "is this current?".
//
// Multi-currency: single-currency only (the dominant currency in the
// underlying series). Mirrors revenueByPlan's pattern. The L2 builder
// already filters series to a single currency; this primitive just respects
// that.

import type { MonthlyAmount } from '../profile/types';

export type GrowthRateMetric =
  | 'recurring_revenue'
  | 'billed_revenue'
  | 'direct_charge_revenue';

export type TrendLabel =
  | 'accelerating'
  | 'decelerating'
  | 'declining'
  | 'flat';

export type GrowthCoverage = 'full' | 'partial' | 'sparse';

export interface GrowthRateRow {
  month: string;               // ISO YYYY-MM
  metric_value: number;        // major units, that month's value
  growth_rate: number | null;  // null for first row (no prior to compare); decimal (0.05 = 5%)
}

export interface GrowthRateResult {
  kind: 'series';
  metric: GrowthRateMetric;
  rows: GrowthRateRow[];
  avg_growth_rate: number;     // mean of non-null growth rates; 0 when no valid rates
  trend_label: TrendLabel;
  currency: string;
  coverage: GrowthCoverage;
  definition: 'javelin_defined.growth_rate';
  window: { months: number };
  as_of: number;
}

export interface GrowthRateInput {
  series: MonthlyAmount[] | undefined;  // from profile.layer2.<series>; may be undefined if profile lacks it
  metric: GrowthRateMetric;
  window: number;                       // requested trailing N months (computes N MoM rates from N+1 data points)
  now: Date;
}

const TREND_THRESHOLD = 0.05; // 5pp

function computeTrendLabel(
  avgGrowth: number,
  growthRates: Array<number | null>,
): TrendLabel {
  if (avgGrowth < 0) return 'declining';

  const validRates = growthRates.filter(
    (r): r is number => r !== null,
  );
  if (validRates.length < 2) return 'flat';

  // Half-split: middle goes to second_half on odd lengths.
  const splitIndex = Math.floor(validRates.length / 2);
  const firstHalf = validRates.slice(0, splitIndex);
  const secondHalf = validRates.slice(splitIndex);

  if (firstHalf.length === 0 || secondHalf.length === 0) return 'flat';

  const firstAvg =
    firstHalf.reduce((s, r) => s + r, 0) / firstHalf.length;
  const secondAvg =
    secondHalf.reduce((s, r) => s + r, 0) / secondHalf.length;
  const diff = secondAvg - firstAvg;

  if (diff > TREND_THRESHOLD) return 'accelerating';
  if (diff < -TREND_THRESHOLD) return 'decelerating';
  return 'flat';
}

export function growthRate(input: GrowthRateInput): GrowthRateResult {
  const { series, metric, window, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  // Empty / missing series — sparse coverage, no rows.
  if (!series || series.length === 0) {
    return {
      kind: 'series',
      metric,
      rows: [],
      avg_growth_rate: 0,
      trend_label: 'flat',
      currency: 'usd', // safe default; consumers should check coverage
      coverage: 'sparse',
      definition: 'javelin_defined.growth_rate',
      window: { months: window },
      as_of: nowSec,
    };
  }

  // Sort ascending by month (ISO YYYY-MM strings sort lexically).
  const sorted = [...series].sort((a, b) => a.month.localeCompare(b.month));
  const currency = sorted[0].currency;

  // Take trailing window+1 entries (need n+1 to compute n MoM rates).
  const needed = window + 1;
  const trailing = sorted.slice(-needed);

  // Coverage classification:
  //   - 'partial' if we have fewer than window+1 data points
  //   - 'sparse' / 'full' computed below based on null-rate ratio
  const hasFullWindow = trailing.length >= needed;

  // Build rows with growth rates.
  const rows: GrowthRateRow[] = trailing.map((entry, i) => {
    if (i === 0) {
      return {
        month: entry.month,
        metric_value: entry.amount,
        growth_rate: null,
      };
    }
    const prev = trailing[i - 1].amount;
    const growth = prev === 0 ? null : (entry.amount - prev) / prev;
    return {
      month: entry.month,
      metric_value: entry.amount,
      growth_rate: growth,
    };
  });

  const growthRates = rows.slice(1).map((r) => r.growth_rate);
  const validRates = growthRates.filter(
    (r): r is number => r !== null,
  );
  const nullRatio =
    growthRates.length === 0 ? 1 : (growthRates.length - validRates.length) / growthRates.length;

  const avgGrowth =
    validRates.length === 0
      ? 0
      : validRates.reduce((s, r) => s + r, 0) / validRates.length;

  let coverage: GrowthCoverage;
  if (!hasFullWindow) coverage = 'partial';
  else if (nullRatio > 0.5) coverage = 'sparse';
  else coverage = 'full';

  const trendLabel = computeTrendLabel(avgGrowth, growthRates);

  return {
    kind: 'series',
    metric,
    rows,
    avg_growth_rate: avgGrowth,
    trend_label: trendLabel,
    currency,
    coverage,
    definition: 'javelin_defined.growth_rate',
    window: { months: window },
    as_of: nowSec,
  };
}
