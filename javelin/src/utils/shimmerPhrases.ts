// V3 chip + shimmer copy. Locked design (per memory):
//   - Chip = info-density tool label (e.g. "Computing MRR…")
//   - Shimmer = personality/flavor secondary line, random from 8-phrase bank
//   - Both display together while the agent loop runs.

/** Locked 8-phrase bank — Stripe-flavored, dry-witty register. */
export const SHIMMER_PHRASES = [
  'consulting the llama…',
  'paging /dev/payments…',
  'nudging the GDP of the internet…',
  'feeding the llama a spreadsheet…',
  'doing the math, Stripe-style…',
  'staying macro-optimistic…',
  'being meticulous about the foundations…',
  'Not winning yet…',
] as const;

/** Tool name → chip label. Add new entries here as tools land. */
export const TOOL_LABELS: Record<string, string> = {
  mrr: 'Computing MRR…',
  mrr_movement: 'Decomposing MRR change…',
  growth_attribution: 'Attributing growth by plan…',
  period_collected_revenue: 'Pulling collected revenue…',
  period_billed_revenue: 'Pulling billed revenue…',
  customer_concentration: 'Checking customer concentration…',
  active_subscription_count: 'Counting active subscriptions…',
  period_net_cash: 'Pulling net cash…',
  period_net_revenue: 'Pulling net revenue…',
  churn_count: 'Counting cancellations…',
  churn_reasons: 'Reading cancellation reasons…',
  paying_customer_count: 'Counting paying customers…',
  revenue_by_plan: 'Pulling revenue by plan…',
  revenue_by_plan_billed: 'Pulling billed revenue by plan…',
  revenue_by_country: 'Pulling revenue by country…',
  churn_rate: 'Computing churn rate…',
  compare_periods: 'Comparing periods…',
  growth_rate: 'Computing growth rate…',
  account_balance: 'Reading the balance…',
  balance_explanation: 'Tracing the ledger…',
  customer_lookup: 'Looking up customer…',
  customer_recent_activity: 'Pulling customer activity…',
  project_revenue: 'Projecting revenue…',
  project_customer_count: 'Projecting customer count…',
  goal_eta: 'Estimating timing…',
  largest_charges_in_period: 'Pulling largest charges…',
  customer_spend_distribution: 'Computing spend distribution…',
  arpu: 'Computing ARPU…',
  ltv: 'Computing LTV…',
  failed_payments: 'Pulling failed payments…',
};

const TOOL_LABEL_FALLBACK = 'Working on it…';

export function labelForTool(toolName: string): string {
  return TOOL_LABELS[toolName] ?? TOOL_LABEL_FALLBACK;
}

/** Pick a random shimmer phrase, avoiding immediate repeat of `prevIndex`. */
export function pickShimmer(prevIndex?: number): {
  phrase: string;
  index: number;
} {
  if (SHIMMER_PHRASES.length <= 1) {
    return { phrase: SHIMMER_PHRASES[0], index: 0 };
  }
  let idx: number;
  do {
    idx = Math.floor(Math.random() * SHIMMER_PHRASES.length);
  } while (idx === prevIndex);
  return { phrase: SHIMMER_PHRASES[idx], index: idx };
}
