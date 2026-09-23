// Short, plain-English descriptions surfaced as Tooltip content when the
// merchant hovers a Source chip below an assistant message. Each entry
// mirrors the canonical metric meaning without leaking internal jargon
// (envelope shapes, RULE numbers, scope flags). Kept under 15 words.
//
// Adding a tool? Add its entry here AND a chip label in shimmerPhrases.ts
// so the streaming chip + the post-stream Source chip stay consistent.

const TOOL_DESCRIPTIONS: Record<string, string> = {
  // Snapshots & counts
  mrr: 'Current monthly subscription run rate, per currency.',
  active_subscription_count: 'Count of active subscriptions right now.',
  paying_customer_count: 'Distinct customers who paid in the period.',
  account_balance:
    'Snapshot of available, pending, and instant-available Stripe balances.',

  // Period revenue
  period_collected_revenue:
    'Succeeded charges minus refunds in the period, per currency.',
  period_billed_revenue:
    'Sum of invoice subtotals (paid, open, and uncollectible) finalized in the period.',
  period_net_revenue:
    'Gross collected minus refunds and chargebacks (processing fees excluded).',
  period_net_cash:
    'What hit your bank: gross collected minus fees, refunds, and chargebacks.',
  balance_explanation:
    'How your Stripe balance moved over the period — activity in vs. payouts out.',

  // Customers
  customer_lookup:
    'Find a customer by name, email, or ID, sorted by recent activity.',
  customer_recent_activity:
    'Recent charges, invoices, subscription changes, and disputes for one customer.',
  customer_concentration:
    'Share of collected revenue from your top-1, top-5, and top-10 customers in the period.',
  customer_spend_distribution:
    'Per-customer spend: median, p25/p75/p90, mean, and top/bottom shares.',

  // Churn
  churn_count:
    'Subscriptions that ended in the period, split by voluntary, involuntary, and other.',
  churn_rate: "Stripe's canonical 30-day rolling subscriber churn rate.",
  churn_reasons:
    'Counts of customer-stated cancellation reasons from the Customer Portal.',

  // MRR movement & growth
  mrr_movement:
    'Decomposes MRR change into new subs, expansion, contraction, and churn.',
  growth_attribution:
    'Per-plan decomposition of MRR change — which plans are driving growth.',
  growth_rate:
    'Trailing-N-month growth percentages for a revenue metric, with a trend label.',

  // Unit economics
  arpu:
    'Mean revenue per paying customer (recurring run-rate or period-collected basis).',
  ltv: 'Subscriber lifetime value — ARPU divided by churn rate (Stripe-canonical).',

  // Comparison & projection
  compare_periods:
    'Compares a single metric between two periods with absolute and percent delta.',
  goal_eta: 'Estimates time to reach a target at current trajectory.',
  project_revenue:
    'Projects a revenue metric forward N months from recent monthly trend.',
  project_customer_count:
    'Projects customer count forward N months from trailing acquisition and churn.',

  // Breakdowns
  revenue_by_plan:
    'Period collected revenue (charges) broken down by plan.',
  revenue_by_plan_billed:
    'Period billed revenue (invoices) broken down by plan.',
  revenue_by_country:
    'Collected revenue by card-issuing country (BIN-derived proxy for buyer location).',
  largest_charges_in_period:
    'Top individual charges by net collected amount in the period.',
  failed_payments:
    'Charges and invoice attempts that failed in the period, with top failures and reasons.',
};

/**
 * Lookup a hover description for a tool name. Falls back to a generic
 * caption when the tool is unknown — keeps the chip+tooltip rendering
 * resilient if a new backend tool ships before this map is updated.
 */
export function descriptionForTool(toolName: string): string {
  return TOOL_DESCRIPTIONS[toolName] ?? 'Used to answer this question.';
}
