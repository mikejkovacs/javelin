// project_customer_count — linear extrapolation of customer count using
// trailing-6m L2 distributions for new customers and churn.
//
// Definition tag: `javelin_defined.project_customer_count`. Stripe publishes
// no canonical projection methodology — verified 2026-05-01 (see
// projectRevenue.ts for the full source list). Methodology Javelin-defined.
//
// monthly_net_additions = new_customer_distribution.median - churn_distribution.median
// projected_value = max(0, current_count + (monthly_net_additions × horizon_months))
//
// CRITICAL LIMITATION (must be disclosed in narration per Rule #10): assumes
// new-customer rate AND churn rate stay flat across the horizon. Does not
// model acquisition acceleration or churn scaling with base size. For a
// fast-growing merchant, absolute churn rises with base; this method does
// not capture that.
//
// trend_label is a 3-label taxonomy ('declining' | 'flat' | 'growing') —
// distinct from growth_rate's 4-label taxonomy because we have no series
// here, so we cannot detect acceleration / deceleration. Sign-of-net decides,
// with a 1%-of-base flat threshold.

import type { Distribution } from '../profile/types';

export type CustomerCountTrend = 'declining' | 'flat' | 'growing';

export type CustomerCountCoverage = 'full' | 'partial' | 'sparse';

export interface ProjectCustomerCountResult {
  kind: 'projection';
  metric: 'customer_count';
  current_value: number;
  monthly_net_additions: number;
  new_customer_median: number;
  churn_median: number;
  trend_label: CustomerCountTrend;
  projected_value: number;
  projected_month: string;        // ISO 'YYYY-MM'
  coverage: CustomerCountCoverage;
  definition: 'javelin_defined.project_customer_count';
  window: { horizon_months: number };
  as_of: number;
}

export interface ProjectCustomerCountInput {
  current_count: number | undefined;
  new_customer_distribution: Distribution | undefined;
  churn_distribution: Distribution | undefined;
  horizon_months: number;     // 1-12
  now: Date;
}

const FLAT_THRESHOLD = 0.01; // 1% of base per month

function nowMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
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

function classifyCoverage(
  newDist: Distribution | undefined,
  churnDist: Distribution | undefined,
): CustomerCountCoverage {
  if (!newDist || !churnDist) return 'sparse';
  const minN = Math.min(newDist.n_months, churnDist.n_months);
  if (minN < 3) return 'sparse';
  if (minN < 6) return 'partial';
  return 'full';
}

export function projectCustomerCount(
  input: ProjectCustomerCountInput,
): ProjectCustomerCountResult {
  const {
    current_count,
    new_customer_distribution,
    churn_distribution,
    horizon_months,
    now,
  } = input;
  const nowSec = Math.floor(now.getTime() / 1000);
  const currentMonth = nowMonth(now);
  const projectedMonth = addMonths(currentMonth, horizon_months);

  let coverage = classifyCoverage(
    new_customer_distribution,
    churn_distribution,
  );
  // Missing current_count is itself a sparse-coverage signal — without it we
  // can't anchor the projection, regardless of distribution health.
  if (current_count === undefined) coverage = 'sparse';

  // Sparse / missing data — degrade gracefully.
  if (
    coverage === 'sparse' ||
    current_count === undefined ||
    !new_customer_distribution ||
    !churn_distribution
  ) {
    return {
      kind: 'projection',
      metric: 'customer_count',
      current_value: current_count ?? 0,
      monthly_net_additions: 0,
      new_customer_median: new_customer_distribution?.median ?? 0,
      churn_median: churn_distribution?.median ?? 0,
      trend_label: 'flat',
      projected_value: current_count ?? 0,
      projected_month: projectedMonth,
      coverage,
      definition: 'javelin_defined.project_customer_count',
      window: { horizon_months },
      as_of: nowSec,
    };
  }

  const newMed = new_customer_distribution.median;
  const churnMed = churn_distribution.median;
  const net = newMed - churnMed;
  const projectedValue = Math.max(0, current_count + net * horizon_months);

  let trendLabel: CustomerCountTrend;
  if (current_count === 0) {
    trendLabel = net > 0 ? 'growing' : net < 0 ? 'declining' : 'flat';
  } else {
    const ratio = Math.abs(net) / current_count;
    if (ratio < FLAT_THRESHOLD) trendLabel = 'flat';
    else if (net > 0) trendLabel = 'growing';
    else trendLabel = 'declining';
  }

  return {
    kind: 'projection',
    metric: 'customer_count',
    current_value: current_count,
    monthly_net_additions: net,
    new_customer_median: newMed,
    churn_median: churnMed,
    trend_label: trendLabel,
    projected_value: projectedValue,
    projected_month: projectedMonth,
    coverage,
    definition: 'javelin_defined.project_customer_count',
    window: { horizon_months },
    as_of: nowSec,
  };
}
