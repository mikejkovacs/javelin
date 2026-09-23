// goal_eta — estimated time to reach a target value at current trajectory.
//
// Definition tag: `javelin_defined.goal_eta`. Stripe publishes no canonical
// projection methodology — verified 2026-05-01 (see projectRevenue.ts for the
// full source list). Methodology Javelin-defined: revenue metrics compound
// via the growth_rate engine (inverse of project_revenue math); customer
// count uses linear net-additions math (inverse of project_customer_count
// math).
//
// Output is a discriminated union by `state`:
//   - 'achieved'    — target ≤ current (already hit)
//   - 'reachable'   — months_to_target ≤ MAX_HORIZON
//   - 'unreachable' — declining/flat trajectory below target, OR
//                     months_to_target > MAX_HORIZON
//
// MAX_HORIZON_MONTHS = 60 (internal constant — not exposed on tool surface).

import { growthRate, type TrendLabel, type GrowthCoverage } from './growthRate';
import type { CustomerCountTrend } from './projectCustomerCount';
import type { Distribution, MonthlyAmount } from '../profile/types';

export const MAX_HORIZON_MONTHS = 60;

export type GoalEtaMetric =
  | 'recurring_revenue'
  | 'billed_revenue'
  | 'direct_charge_revenue'
  | 'customer_count';

export type GoalEtaCoverage = 'full' | 'partial' | 'sparse';

interface GoalEtaCommon {
  kind: 'goal_eta';
  metric: GoalEtaMetric;
  target_value: number;
  current_value: number;
  currency?: string;
  trend_label: TrendLabel | CustomerCountTrend;
  monthly_growth_rate?: number;
  monthly_net_additions?: number;
  coverage: GoalEtaCoverage;
  /** Path A+ — canonical MRR state snapshot (L1 scale.mrr_amount), populated
   *  only when metric === 'recurring_revenue' and L1 mrr_amount is provided.
   *  When |this − current_value| / this > 10%, the LLM should narrate dual
   *  citation per Rule #10's NOTE clause. */
  current_l1_state_mrr?: number | null;
  definition: 'javelin_defined.goal_eta';
  window: { lookback_months?: number; max_horizon_months: number };
  as_of: number;
}

export type GoalEtaResult = GoalEtaCommon &
  (
    | { state: 'achieved'; achieved_at_iso: string | null }
    | { state: 'reachable'; months_to_target: number; target_eta_iso: string }
    | {
        state: 'unreachable';
        unreachable_reason: 'declining' | 'flat' | 'too_distant';
        months_required: number | null;
      }
  );

export interface GoalEtaInput {
  metric: GoalEtaMetric;
  target_value: number;
  // Revenue metrics:
  series?: MonthlyAmount[];
  lookback_months?: number;
  /** L1 scale.mrr_amount — only used when metric === 'recurring_revenue'. */
  l1_state_mrr?: number;
  // Customer count:
  current_count?: number;
  new_customer_distribution?: Distribution;
  churn_distribution?: Distribution;
  // Common:
  now: Date;
}

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

function classifyCustomerCountCoverage(
  newDist: Distribution | undefined,
  churnDist: Distribution | undefined,
): GoalEtaCoverage {
  if (!newDist || !churnDist) return 'sparse';
  const minN = Math.min(newDist.n_months, churnDist.n_months);
  if (minN < 3) return 'sparse';
  if (minN < 6) return 'partial';
  return 'full';
}

function isRevenueMetric(
  metric: GoalEtaMetric,
): metric is 'recurring_revenue' | 'billed_revenue' | 'direct_charge_revenue' {
  return metric !== 'customer_count';
}

export function goalEta(input: GoalEtaInput): GoalEtaResult {
  const { metric, target_value, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  if (isRevenueMetric(metric)) {
    return goalEtaRevenue(input, metric, nowSec);
  }
  return goalEtaCustomerCount(input, nowSec);
}

function goalEtaRevenue(
  input: GoalEtaInput,
  metric: 'recurring_revenue' | 'billed_revenue' | 'direct_charge_revenue',
  nowSec: number,
): GoalEtaResult {
  const { target_value, series, lookback_months = 6, now, l1_state_mrr } = input;

  const growth = growthRate({
    series,
    metric,
    window: lookback_months,
    now,
  });

  const baseCommon: GoalEtaCommon = {
    kind: 'goal_eta',
    metric,
    target_value,
    current_value: 0,
    currency: growth.currency,
    trend_label: growth.trend_label,
    monthly_growth_rate: growth.avg_growth_rate,
    coverage: growth.coverage,
    ...(metric === 'recurring_revenue' && typeof l1_state_mrr === 'number'
      ? { current_l1_state_mrr: l1_state_mrr }
      : {}),
    definition: 'javelin_defined.goal_eta',
    window: { lookback_months, max_horizon_months: MAX_HORIZON_MONTHS },
    as_of: nowSec,
  };

  // Sparse / no series — can't project. Treat as unreachable / flat.
  if (growth.coverage === 'sparse' || growth.rows.length === 0) {
    return {
      ...baseCommon,
      state: 'unreachable',
      unreachable_reason: 'flat',
      months_required: null,
    };
  }

  const lastRow = growth.rows[growth.rows.length - 1];
  const currentValue = lastRow.metric_value;
  const currentMonth = lastRow.month;
  const rate = growth.avg_growth_rate;

  const common = { ...baseCommon, current_value: currentValue };

  // Already achieved branch.
  if (target_value <= currentValue) {
    // Walk rows ascending to find first month where value >= target.
    let achievedAt: string | null = null;
    for (const row of growth.rows) {
      if (row.metric_value >= target_value) {
        achievedAt = row.month;
        break;
      }
    }
    return {
      ...common,
      state: 'achieved',
      achieved_at_iso: achievedAt,
    };
  }

  // From here: target > currentValue.
  // Unreachable due to non-positive trajectory.
  if (rate <= 0) {
    return {
      ...common,
      state: 'unreachable',
      unreachable_reason: rate < 0 ? 'declining' : 'flat',
      months_required: null,
    };
  }

  // Compounding: months = ceil(log(target/current) / log(1 + rate))
  const months = Math.ceil(
    Math.log(target_value / currentValue) / Math.log(1 + rate),
  );

  if (months > MAX_HORIZON_MONTHS) {
    return {
      ...common,
      state: 'unreachable',
      unreachable_reason: 'too_distant',
      months_required: months,
    };
  }

  return {
    ...common,
    state: 'reachable',
    months_to_target: months,
    target_eta_iso: addMonths(currentMonth, months),
  };
}

function goalEtaCustomerCount(input: GoalEtaInput, nowSec: number): GoalEtaResult {
  const {
    target_value,
    current_count,
    new_customer_distribution,
    churn_distribution,
    now,
  } = input;

  const coverage = classifyCustomerCountCoverage(
    new_customer_distribution,
    churn_distribution,
  );

  // Sparse / no inputs → unreachable, flat.
  if (
    coverage === 'sparse' ||
    current_count === undefined ||
    !new_customer_distribution ||
    !churn_distribution
  ) {
    return {
      kind: 'goal_eta',
      metric: 'customer_count',
      target_value,
      current_value: current_count ?? 0,
      trend_label: 'flat',
      coverage,
      definition: 'javelin_defined.goal_eta',
      window: { max_horizon_months: MAX_HORIZON_MONTHS },
      as_of: nowSec,
      state: 'unreachable',
      unreachable_reason: 'flat',
      months_required: null,
    };
  }

  const newMed = new_customer_distribution.median;
  const churnMed = churn_distribution.median;
  const net = newMed - churnMed;

  let trendLabel: CustomerCountTrend;
  if (current_count === 0) {
    trendLabel = net > 0 ? 'growing' : net < 0 ? 'declining' : 'flat';
  } else {
    const ratio = Math.abs(net) / current_count;
    if (ratio < 0.01) trendLabel = 'flat';
    else if (net > 0) trendLabel = 'growing';
    else trendLabel = 'declining';
  }

  const common: GoalEtaCommon = {
    kind: 'goal_eta',
    metric: 'customer_count',
    target_value,
    current_value: current_count,
    trend_label: trendLabel,
    monthly_net_additions: net,
    coverage,
    definition: 'javelin_defined.goal_eta',
    window: { max_horizon_months: MAX_HORIZON_MONTHS },
    as_of: nowSec,
  };

  // Achieved.
  if (target_value <= current_count) {
    return {
      ...common,
      state: 'achieved',
      achieved_at_iso: null, // no series for customer count
    };
  }

  // From here: target > current.
  if (net <= 0) {
    return {
      ...common,
      state: 'unreachable',
      unreachable_reason: net < 0 ? 'declining' : 'flat',
      months_required: null,
    };
  }

  const months = Math.ceil((target_value - current_count) / net);

  if (months > MAX_HORIZON_MONTHS) {
    return {
      ...common,
      state: 'unreachable',
      unreachable_reason: 'too_distant',
      months_required: months,
    };
  }

  return {
    ...common,
    state: 'reachable',
    months_to_target: months,
    target_eta_iso: addMonths(nowMonth(now), months),
  };
}
