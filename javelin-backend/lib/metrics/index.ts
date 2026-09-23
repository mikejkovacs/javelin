// Barrel export for the metrics layer. Frontend bundler imports from here:
//   import { mrr, activeSubscriptionCount } from '../../../javelin-backend/lib/metrics';
//
// V2 function files are Zod-free (Option A from M1 scaffold discussion) — runtime
// schemas arrive with V3 tool wrappers in sibling *.schema.ts files.

export {
  subscriptionEnriched,
  type SubscriptionEnrichedInput,
  type SubscriptionEnrichedResult,
  type SubscriptionEnrichedRow,
  type StripeSubscriptionLike,
  type StripeSubscriptionItemLike,
  type StripeDiscountLike,
} from './subscriptionEnriched';

export { mrr, type MrrInput, type MrrResult, type MrrRow } from './mrr';

export {
  activeSubscriptionCount,
  type ActiveSubscriptionCountInput,
  type ActiveSubscriptionCountResult,
} from './activeSubscriptionCount';

// ── M2.1 (Charges) ───────────────────────────────────────────────────────────

export {
  chargeEnriched,
  type ChargeEnrichedInput,
  type ChargeEnrichedResult,
  type ChargeEnrichedRow,
  type StripeChargeLike,
  type StripeBalanceTransactionLike,
} from './chargeEnriched';

export {
  periodCollectedRevenue,
  type PeriodCollectedRevenueInput,
  type PeriodCollectedRevenueResult,
  type PeriodCollectedRevenueRow,
} from './periodCollectedRevenue';

export {
  periodNetRevenue,
  type PeriodNetRevenueInput,
  type PeriodNetRevenueResult,
  type PeriodNetRevenueRow,
  type StripeDisputeLike,
} from './periodNetRevenue';

export {
  periodNetCash,
  type PeriodNetCashInput,
  type PeriodNetCashResult,
  type PeriodNetCashRow,
} from './periodNetCash';

// ── M2.2 (Invoices) ──────────────────────────────────────────────────────────

export {
  invoiceEnriched,
  type InvoiceEnrichedInput,
  type InvoiceEnrichedResult,
  type InvoiceEnrichedRow,
  type StripeInvoiceLike,
  type StripeInvoiceLineItemLike,
} from './invoiceEnriched';

export {
  periodBilledRevenue,
  periodBilledRevenueInclusiveOfTax,
  type PeriodBilledRevenueInput,
  type PeriodBilledRevenueResult,
  type PeriodBilledRevenueRow,
} from './periodBilledRevenue';

// ── M2.3 (Customer rollups) ──────────────────────────────────────────────────

export {
  customerRollup,
  type CustomerRollupInput,
  type CustomerRollupResult,
  type CustomerRollupRow,
  type CustomerRollupSubscription,
  type StripeCustomerLike,
} from './customerRollup';

export {
  customerConcentration,
  type CustomerConcentrationInput,
  type CustomerConcentrationResult,
  type CustomerConcentrationRow,
  type CustomerConcentrationValue,
} from './customerConcentration';

export {
  churnCount,
  type ChurnCountInput,
  type ChurnCountResult,
  type ChurnCountValue,
  type BreakdownSignificance,
} from './churnCount';

export {
  churnReasons,
  type ChurnReasonsInput,
  type ChurnReasonsResult,
  type ChurnReasonsValue,
  type ChurnReasonsBuckets,
  type CoverageLevel,
} from './churnReasons';

export {
  payingCustomerCount,
  type PayingCustomerCountInput,
  type PayingCustomerCountResult,
} from './payingCustomerCount';

export {
  revenueByPlan,
  type RevenueByPlanInput,
  type RevenueByPlanResult,
  type RevenueByPlanRow,
} from './revenueByPlan';

export {
  revenueByCountry,
  type RevenueByCountryInput,
  type RevenueByCountryResult,
  type RevenueByCountryRow,
} from './revenueByCountry';

export {
  growthRate,
  type GrowthRateInput,
  type GrowthRateResult,
  type GrowthRateRow,
  type GrowthRateMetric,
  type TrendLabel,
  type GrowthCoverage,
} from './growthRate';

export {
  projectRevenue,
  type ProjectRevenueInput,
  type ProjectRevenueResult,
  type ProjectRevenueMetric,
} from './projectRevenue';

export {
  projectCustomerCount,
  type ProjectCustomerCountInput,
  type ProjectCustomerCountResult,
  type CustomerCountTrend,
  type CustomerCountCoverage,
} from './projectCustomerCount';

export {
  goalEta,
  type GoalEtaInput,
  type GoalEtaResult,
  type GoalEtaMetric,
  type GoalEtaCoverage,
  MAX_HORIZON_MONTHS,
} from './goalEta';

export {
  seriesForMetric,
  type RevenueSeriesMetric,
} from './seriesSelect';

export {
  churnRate,
  type ChurnRateInput,
  type ChurnRateResult,
  type ChurnRateComponents,
} from './churnRate';

export {
  comparePeriods,
  type ComparePeriodsInput,
  type ComparePeriodsResult,
  type CompareableMetric,
  type Direction,
} from './comparePeriods';

export {
  accountBalance,
  type AccountBalanceInput,
  type AccountBalanceResult,
  type BalanceSurfaceRow,
  type PendingSettlementRow,
} from './accountBalance';

export {
  balanceExplanation,
  type BalanceExplanationInput,
  type BalanceExplanationResult,
  type CurrencyBlock,
  type ActivityRow,
  type ReportingCategory,
} from './balanceExplanation';

export {
  customerLookup,
  type CustomerLookupInput,
  type CustomerLookupResult,
  type CustomerLookupRow,
  type CustomerLookupMatchStrategy,
} from './customerLookup';

export {
  customerRecentActivity,
  type CustomerRecentActivityInput,
  type CustomerRecentActivityResult,
  type ActivityEvent,
  type ActivityEventType,
  type SubscriptionUpdateEvent,
  type UpcomingCancellation,
  SUBSCRIPTION_HISTORY_WINDOW_DAYS,
} from './customerRecentActivity';

export {
  arpu,
  type ArpuInput,
  type ArpuResult,
  type ArpuRow,
  type ArpuBasis,
} from './arpu';

export {
  failedPayments,
  type FailedPaymentsInput,
  type FailedPaymentsResult,
  type FailedPaymentsRow,
  type FailedPaymentEntry,
  type FailureReasonBucketRow,
} from './failedPayments';

export {
  type Period,
  type CurrencyCode,
  minorUnitDivisor,
  toMajor,
  type TableMetadata,
  type TableColumn,
  type TableCellFormat,
} from './types';
