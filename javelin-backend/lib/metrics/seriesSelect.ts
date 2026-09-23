// Shared helper: pick the L2 monthly series for a given revenue metric.
//
// Used by tools that operate over the trailing-12m revenue series (growth_rate,
// project_revenue, goal_eta). Centralized so the metric → series mapping has
// one source of truth.

import type { Profile } from '../profile';
import type { MonthlyAmount } from '../profile/types';

export type RevenueSeriesMetric =
  | 'recurring_revenue'
  | 'billed_revenue'
  | 'direct_charge_revenue';

export function seriesForMetric(
  profile: Profile | undefined,
  metric: RevenueSeriesMetric,
): MonthlyAmount[] | undefined {
  if (!profile?.layer2) return undefined;
  switch (metric) {
    case 'recurring_revenue':
      return profile.layer2.monthly_recurring_billed_series;
    case 'billed_revenue':
      return profile.layer2.monthly_billed_revenue_series;
    case 'direct_charge_revenue':
      return profile.layer2.monthly_collected_charges_series;
  }
}
