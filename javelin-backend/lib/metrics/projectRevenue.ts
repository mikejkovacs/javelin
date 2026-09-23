// project_revenue — trend-aware compounding projection of a revenue metric.
//
// Definition tag: `javelin_defined.project_revenue`. Stripe publishes no
// canonical projection methodology — verified 2026-05-01 across:
//   - https://stripe.com/resources/more/saas-revenue-forecasting (marketing,
//     describes MRR-buildup concepts but no formulas — source-hierarchy tier 5)
//   - https://docs.stripe.com/billing/subscriptions/analytics (purely
//     retrospective, no forward-looking surfaces)
//   - Stripe Sigma (SQL-only, no canonical projection schema)
// Methodology Javelin-defined: trend-aware compounding extrapolation from L2
// series via the existing growth_rate engine.
//
// projected_value = current_value × (1 + monthly_growth_rate)^horizon_months
//
// where current_value, monthly_growth_rate, and trend_label all pass through
// from growth_rate over the requested lookback window. The LLM narrates with
// CRITICAL RULE #10 framing (conditional verb tense, trend disclosure).

import { growthRate, type TrendLabel, type GrowthCoverage } from './growthRate';
import type { MonthlyAmount } from '../profile/types';

export type ProjectRevenueMetric =
  | 'recurring_revenue'
  | 'billed_revenue'
  | 'direct_charge_revenue';

export interface ProjectRevenueResult {
  kind: 'projection';
  metric: ProjectRevenueMetric;
  current_value: number;          // major units, last month in trailing window
  current_month: string;          // ISO 'YYYY-MM'
  monthly_growth_rate: number;    // decimal; passes through growthRate.avg_growth_rate
  trend_label: TrendLabel;
  projected_value: number;        // major units, current_value × (1+rate)^horizon
  projected_month: string;        // ISO 'YYYY-MM' at horizon
  currency: string;
  coverage: GrowthCoverage;
  /** Path A+ — canonical MRR state snapshot (L1 scale.mrr_amount), populated
   *  only when metric === 'recurring_revenue' and L1 mrr_amount is provided.
   *  When |this − current_value| / this > 10%, the LLM should narrate dual
   *  citation per Rule #10's NOTE clause. */
  current_l1_state_mrr?: number | null;
  definition: 'javelin_defined.project_revenue';
  window: { lookback_months: number; horizon_months: number };
  as_of: number;
}

export interface ProjectRevenueInput {
  series: MonthlyAmount[] | undefined;
  metric: ProjectRevenueMetric;
  lookback_months: number;     // 2-12; passed to growthRate as window
  horizon_months: number;      // 1-12
  now: Date;
  /** L1 scale.mrr_amount — only used when metric === 'recurring_revenue'. */
  l1_state_mrr?: number;
}

function addMonths(isoMonth: string, n: number): string {
  const [yStr, mStr] = isoMonth.split('-');
  let year = parseInt(yStr, 10);
  let month = parseInt(mStr, 10) + n;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function projectRevenue(input: ProjectRevenueInput): ProjectRevenueResult {
  const { series, metric, lookback_months, horizon_months, now, l1_state_mrr } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  const l1Field =
    metric === 'recurring_revenue' && typeof l1_state_mrr === 'number'
      ? { current_l1_state_mrr: l1_state_mrr }
      : {};

  const growth = growthRate({
    series,
    metric,
    window: lookback_months,
    now,
  });

  // Sparse / empty series — degrade gracefully.
  if (growth.coverage === 'sparse' || growth.rows.length === 0) {
    const fallbackMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return {
      kind: 'projection',
      metric,
      current_value: 0,
      current_month: fallbackMonth,
      monthly_growth_rate: 0,
      trend_label: 'flat',
      projected_value: 0,
      projected_month: addMonths(fallbackMonth, horizon_months),
      currency: growth.currency,
      coverage: growth.coverage,
      ...l1Field,
      definition: 'javelin_defined.project_revenue',
      window: { lookback_months, horizon_months },
      as_of: nowSec,
    };
  }

  const lastRow = growth.rows[growth.rows.length - 1];
  const currentValue = lastRow.metric_value;
  const currentMonth = lastRow.month;
  const rate = growth.avg_growth_rate;

  const projectedValue = currentValue * Math.pow(1 + rate, horizon_months);
  const projectedMonth = addMonths(currentMonth, horizon_months);

  return {
    kind: 'projection',
    metric,
    current_value: currentValue,
    current_month: currentMonth,
    monthly_growth_rate: rate,
    trend_label: growth.trend_label,
    projected_value: projectedValue,
    projected_month: projectedMonth,
    currency: growth.currency,
    coverage: growth.coverage,
    ...l1Field,
    definition: 'javelin_defined.project_revenue',
    window: { lookback_months, horizon_months },
    as_of: nowSec,
  };
}
