import { tool } from 'ai';
import { buildMrrTool } from './mrrTool';
import { buildMrrMovementTool } from './mrrMovementTool';
import { buildGrowthAttributionTool } from './growthAttributionTool';
import { buildPeriodCollectedRevenueTool } from './periodCollectedRevenueTool';
import { buildPeriodBilledRevenueTool } from './periodBilledRevenueTool';
import { buildCustomerConcentrationTool } from './customerConcentrationTool';
import { buildActiveSubscriptionCountTool } from './activeSubscriptionCountTool';
import { buildPeriodNetCashTool } from './periodNetCashTool';
import { buildPeriodNetRevenueTool } from './periodNetRevenueTool';
import { buildChurnCountTool } from './churnCountTool';
import { buildChurnReasonsTool } from './churnReasonsTool';
import { buildPayingCustomerCountTool } from './payingCustomerCountTool';
import { buildRevenueByPlanTool } from './revenueByPlanTool';
import { buildRevenueByPlanBilledTool } from './revenueByPlanBilledTool';
import { buildRevenueByCountryTool } from './revenueByCountryTool';
import { buildChurnRateTool } from './churnRateTool';
import { buildComparePeriodsTool } from './comparePeriodsTool';
import { buildGrowthRateTool } from './growthRateTool';
import { buildAccountBalanceTool } from './accountBalanceTool';
import { buildBalanceExplanationTool } from './balanceExplanationTool';
import { buildCustomerLookupTool } from './customerLookupTool';
import { buildCustomerRecentActivityTool } from './customerRecentActivityTool';
import { buildProjectRevenueTool } from './projectRevenueTool';
import { buildProjectCustomerCountTool } from './projectCustomerCountTool';
import { buildGoalEtaTool } from './goalEtaTool';
import { buildLargestChargesTool } from './largestChargesTool';
import { buildCustomerSpendDistributionTool } from './customerSpendDistributionTool';
import { buildArpuTool } from './arpuTool';
import { buildFailedPaymentsTool } from './failedPaymentsTool';
import { buildLtvTool } from './ltvTool';
import type { Profile } from '../../profile';
import { withTiming } from '../timing';

/**
 * Build the V3 tool set scoped to a verified merchant accountId.
 * Each tool's execute() uses platform-key + Stripe-Account header
 * (Item 1 pattern) to fetch live Stripe data for that merchant.
 *
 * `profile` is optional and used by tools that read from the L2
 * profile envelope (currently `growth_rate`). When omitted, those
 * tools degrade gracefully (returning `coverage: 'sparse'` rather
 * than throwing).
 *
 * LATENCY INSTRUMENTATION (2026-05-13): every tool returned here has its
 * `execute()` wrapped with `withTiming` so each invocation emits one
 * `[TIMING] tool_end {...}` log line with the tool name + duration_ms.
 * The wrap is applied at build time via `instrumentTool()`; the underlying
 * `tool()` definition from the `ai` SDK is otherwise unchanged (description,
 * inputSchema, and types pass through).
 */
export function buildTools(accountId: string, profile?: Profile) {
  return {
    mrr: instrumentTool('mrr', buildMrrTool(accountId)),
    mrr_movement: instrumentTool('mrr_movement', buildMrrMovementTool(accountId)),
    growth_attribution: instrumentTool(
      'growth_attribution',
      buildGrowthAttributionTool(accountId),
    ),
    period_collected_revenue: instrumentTool(
      'period_collected_revenue',
      buildPeriodCollectedRevenueTool(accountId),
    ),
    period_billed_revenue: instrumentTool(
      'period_billed_revenue',
      buildPeriodBilledRevenueTool(accountId),
    ),
    customer_concentration: instrumentTool(
      'customer_concentration',
      buildCustomerConcentrationTool(accountId),
    ),
    active_subscription_count: instrumentTool(
      'active_subscription_count',
      buildActiveSubscriptionCountTool(accountId),
    ),
    period_net_cash: instrumentTool('period_net_cash', buildPeriodNetCashTool(accountId)),
    period_net_revenue: instrumentTool(
      'period_net_revenue',
      buildPeriodNetRevenueTool(accountId),
    ),
    churn_count: instrumentTool('churn_count', buildChurnCountTool(accountId)),
    churn_reasons: instrumentTool('churn_reasons', buildChurnReasonsTool(accountId)),
    paying_customer_count: instrumentTool(
      'paying_customer_count',
      buildPayingCustomerCountTool(accountId),
    ),
    revenue_by_plan: instrumentTool('revenue_by_plan', buildRevenueByPlanTool(accountId)),
    revenue_by_plan_billed: instrumentTool(
      'revenue_by_plan_billed',
      buildRevenueByPlanBilledTool(accountId),
    ),
    revenue_by_country: instrumentTool(
      'revenue_by_country',
      buildRevenueByCountryTool(accountId),
    ),
    churn_rate: instrumentTool('churn_rate', buildChurnRateTool(accountId)),
    compare_periods: instrumentTool('compare_periods', buildComparePeriodsTool(accountId)),
    growth_rate: instrumentTool('growth_rate', buildGrowthRateTool(accountId, profile)),
    account_balance: instrumentTool(
      'account_balance',
      buildAccountBalanceTool(accountId),
    ),
    balance_explanation: instrumentTool(
      'balance_explanation',
      buildBalanceExplanationTool(accountId),
    ),
    customer_lookup: instrumentTool('customer_lookup', buildCustomerLookupTool(accountId)),
    customer_recent_activity: instrumentTool(
      'customer_recent_activity',
      buildCustomerRecentActivityTool(accountId),
    ),
    project_revenue: instrumentTool(
      'project_revenue',
      buildProjectRevenueTool(accountId, profile),
    ),
    project_customer_count: instrumentTool(
      'project_customer_count',
      buildProjectCustomerCountTool(accountId, profile),
    ),
    goal_eta: instrumentTool('goal_eta', buildGoalEtaTool(accountId, profile)),
    largest_charges_in_period: instrumentTool(
      'largest_charges_in_period',
      buildLargestChargesTool(accountId),
    ),
    customer_spend_distribution: instrumentTool(
      'customer_spend_distribution',
      buildCustomerSpendDistributionTool(accountId),
    ),
    arpu: instrumentTool('arpu', buildArpuTool(accountId)),
    failed_payments: instrumentTool('failed_payments', buildFailedPaymentsTool(accountId)),
    ltv: instrumentTool('ltv', buildLtvTool(accountId)),
  };
}

/**
 * Rebuild an `ai`-SDK tool with its `execute()` wrapped in a timing logger.
 * Preserves the original description, inputSchema, and types — only the
 * execute path is rerouted through `withTiming`. The cast through `unknown`
 * is required because the SDK's tool type narrows `execute`'s parameter type
 * by the inputSchema; we don't actually change its shape, just instrument it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function instrumentTool<T extends ReturnType<typeof tool<any, any>>>(
  name: string,
  built: T,
): T {
  // The `ai` SDK's tool object stores execute on the returned definition.
  // We rebuild via `tool()` with the same description/inputSchema and a
  // wrapped execute. Cast is a no-op at runtime.
  const original = built as unknown as {
    description?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: (input: any) => Promise<any>;
  };
  if (typeof original.execute !== 'function') {
    // Defensive: if the SDK shape changes, fall through with no instrumentation
    // rather than crashing the route.
    console.warn(`[TIMING] tool=${name} has no execute() — skipping instrumentation`);
    return built;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedExecute = withTiming(name, 'tool', original.execute) as (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any,
  ) => // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Promise<any>;

  return tool({
    description: original.description ?? '',
    inputSchema: original.inputSchema,
    execute: wrappedExecute,
  }) as unknown as T;
}
