// Aggregator — flat list of all eval cases. Imported by runner.test.ts and
// iterated with one Vitest `it()` per case.
//
// To add a new case: append to the appropriate per-tool file (or
// crossCutting.cases.ts for cases that don't belong to a single tool), then
// it appears here automatically via the spread.

import type { EvalCase } from '../assertions';
import { MRR_CASES } from './mrr.cases';
import { MRR_MOVEMENT_CASES } from './mrrMovement.cases';
import { GROWTH_ATTRIBUTION_CASES } from './growthAttribution.cases';
import { ACTIVE_SUBSCRIPTION_COUNT_CASES } from './activeSubscriptionCount.cases';
import { PERIOD_COLLECTED_REVENUE_CASES } from './periodCollectedRevenue.cases';
import { PERIOD_BILLED_REVENUE_CASES } from './periodBilledRevenue.cases';
import { PERIOD_NET_CASH_CASES } from './periodNetCash.cases';
import { PERIOD_NET_REVENUE_CASES } from './periodNetRevenue.cases';
import { CUSTOMER_CONCENTRATION_CASES } from './customerConcentration.cases';
import { CHURN_COUNT_CASES } from './churnCount.cases';
import { CHURN_REASONS_CASES } from './churnReasons.cases';
import { PAYING_CUSTOMER_COUNT_CASES } from './payingCustomerCount.cases';
import { REVENUE_BY_PLAN_CASES } from './revenueByPlan.cases';
import { REVENUE_BY_PLAN_BILLED_CASES } from './revenueByPlanBilled.cases';
import { REVENUE_BY_COUNTRY_CASES } from './revenueByCountry.cases';
import { CHURN_RATE_CASES } from './churnRate.cases';
import { COMPARE_PERIODS_CASES } from './comparePeriods.cases';
import { GROWTH_RATE_CASES } from './growthRate.cases';
import { PROJECT_REVENUE_CASES } from './projectRevenue.cases';
import { PROJECT_CUSTOMER_COUNT_CASES } from './projectCustomerCount.cases';
import { GOAL_ETA_CASES } from './goalEta.cases';
import { ACCOUNT_BALANCE_CASES } from './accountBalance.cases';
import { BALANCE_EXPLANATION_CASES } from './balanceExplanation.cases';
import { CUSTOMER_LOOKUP_CASES } from './customerLookup.cases';
import { CUSTOMER_RECENT_ACTIVITY_CASES } from './customerRecentActivity.cases';
import { LARGEST_CHARGES_CASES } from './largestCharges.cases';
import { CUSTOMER_SPEND_DISTRIBUTION_CASES } from './customerSpendDistribution.cases';
import { CROSS_CUTTING_CASES } from './crossCutting.cases';
import { ARPU_CASES } from './arpu.cases';
import { FAILED_PAYMENTS_CASES } from './failedPayments.cases';
import { LTV_CASES } from './ltv.cases';

export const ALL_CASES: EvalCase[] = [
  ...MRR_CASES,
  ...MRR_MOVEMENT_CASES,
  ...GROWTH_ATTRIBUTION_CASES,
  ...ACTIVE_SUBSCRIPTION_COUNT_CASES,
  ...PERIOD_COLLECTED_REVENUE_CASES,
  ...PERIOD_BILLED_REVENUE_CASES,
  ...PERIOD_NET_CASH_CASES,
  ...PERIOD_NET_REVENUE_CASES,
  ...CUSTOMER_CONCENTRATION_CASES,
  ...CHURN_COUNT_CASES,
  ...CHURN_REASONS_CASES,
  ...PAYING_CUSTOMER_COUNT_CASES,
  ...REVENUE_BY_PLAN_CASES,
  ...REVENUE_BY_PLAN_BILLED_CASES,
  ...REVENUE_BY_COUNTRY_CASES,
  ...CHURN_RATE_CASES,
  ...COMPARE_PERIODS_CASES,
  ...GROWTH_RATE_CASES,
  ...PROJECT_REVENUE_CASES,
  ...PROJECT_CUSTOMER_COUNT_CASES,
  ...GOAL_ETA_CASES,
  ...ACCOUNT_BALANCE_CASES,
  ...BALANCE_EXPLANATION_CASES,
  ...CUSTOMER_LOOKUP_CASES,
  ...CUSTOMER_RECENT_ACTIVITY_CASES,
  ...LARGEST_CHARGES_CASES,
  ...CUSTOMER_SPEND_DISTRIBUTION_CASES,
  ...ARPU_CASES,
  ...FAILED_PAYMENTS_CASES,
  ...LTV_CASES,
  ...CROSS_CUTTING_CASES,
];
