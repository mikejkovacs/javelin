// compare_periods — meta-helper that takes a scalar metric value for two
// periods and returns the comparison (delta + direction).
//
// Spec: Build plan/metric-definitions.md L460–L478.
//
// Definition tag: `javelin_defined.compare_periods`. No Stripe canonical for
// this comparison helper; it's a Javelin-defined wrapper.
//
// Architecture: this primitive does PURE delta math. It does NOT fetch or
// dispatch to other primitives — the tool wrapper is responsible for fetching
// data, calling each downstream primitive once per period, extracting the
// scalar (handling per-currency rows by picking account.default_currency),
// and passing the two scalars to this primitive.
//
// Direction enum is kept (per Q9 of the batch design) because LLMs can fumble
// negative-delta-as-good cases — churn going down is good, revenue going down
// is bad. The LLM uses direction + metric semantics together.

import type { Period } from './types';

const FLAT_EPSILON_USD = 0.01; // sub-penny diffs read as flat for revenue
const FLAT_EPSILON_COUNT = 0.5; // any non-zero integer delta breaks flat

export type Direction = 'up' | 'down' | 'flat';

export type CompareableMetric =
  | 'period_collected_revenue'
  | 'period_billed_revenue'
  | 'period_net_cash'
  | 'period_net_revenue'
  | 'churn_count'
  | 'paying_customer_count';

export interface ComparePeriodsResult {
  kind: 'scalar';
  metric: CompareableMetric;
  a: { value: number; period: Period };
  b: { value: number; period: Period };
  delta_absolute: number;                          // b - a
  delta_percent: number | null;                    // (b-a)/a; null if a is 0
  direction: Direction;
  unit: 'usd' | 'count';
  currency?: string;                               // for usd unit only
  definition: 'javelin_defined.compare_periods';
  as_of: number;
}

export interface ComparePeriodsInput {
  metric: CompareableMetric;
  a: { value: number; period: Period };
  b: { value: number; period: Period };
  unit: 'usd' | 'count';
  currency?: string;
  now: Date;
}

export function comparePeriods(input: ComparePeriodsInput): ComparePeriodsResult {
  const { metric, a, b, unit, currency, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  const delta_absolute = b.value - a.value;
  const epsilon = unit === 'usd' ? FLAT_EPSILON_USD : FLAT_EPSILON_COUNT;
  const direction: Direction =
    delta_absolute > epsilon ? 'up' : delta_absolute < -epsilon ? 'down' : 'flat';

  const delta_percent = a.value === 0 ? null : delta_absolute / a.value;

  return {
    kind: 'scalar',
    metric,
    a,
    b,
    delta_absolute,
    delta_percent,
    direction,
    unit,
    ...(currency ? { currency } : {}),
    definition: 'javelin_defined.compare_periods',
    as_of: nowSec,
  };
}
