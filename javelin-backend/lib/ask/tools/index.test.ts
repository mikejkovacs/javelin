import { describe, it, expect } from 'vitest';
import { buildTools } from './index';

describe('buildTools', () => {
  it('returns the 30 expected tool names', () => {
    const tools = buildTools('acct_test123');
    expect(Object.keys(tools).sort()).toEqual([
      'account_balance',
      'active_subscription_count',
      'arpu',
      'balance_explanation',
      'churn_count',
      'churn_rate',
      'churn_reasons',
      'compare_periods',
      'customer_concentration',
      'customer_lookup',
      'customer_recent_activity',
      'customer_spend_distribution',
      'failed_payments',
      'goal_eta',
      'growth_attribution',
      'growth_rate',
      'largest_charges_in_period',
      'ltv',
      'mrr',
      'mrr_movement',
      'paying_customer_count',
      'period_billed_revenue',
      'period_collected_revenue',
      'period_net_cash',
      'period_net_revenue',
      'project_customer_count',
      'project_revenue',
      'revenue_by_country',
      'revenue_by_plan',
      'revenue_by_plan_billed',
    ]);
  });

  it('each tool has a description and an execute function', () => {
    const tools = buildTools('acct_test123');
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description, `${name} should have a description`).toBeTruthy();
      expect(typeof t.execute, `${name} should have an execute function`).toBe(
        'function',
      );
    }
  });
});
