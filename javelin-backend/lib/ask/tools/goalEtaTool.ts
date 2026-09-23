import { tool } from 'ai';
import { z } from 'zod';
import { goalEta } from '../../metrics/goalEta';
import { seriesForMetric } from '../../metrics/seriesSelect';
import type { Profile } from '../../profile';

export const GOAL_ETA_INPUT_SCHEMA = z
  .object({
    metric: z
      .enum([
        'recurring_revenue',
        'billed_revenue',
        'direct_charge_revenue',
        'customer_count',
      ])
      .describe(
        'Which metric to estimate ETA for. recurring_revenue = subscription billings (MRR proxy); billed_revenue = all invoiced revenue; direct_charge_revenue = one-time payments; customer_count = total customers.',
      ),
    target_value: z
      .number()
      .describe(
        'Target value to reach. For revenue metrics, in major units (dollars). For customer_count, raw count.',
      ),
    lookback_months: z
      .number()
      .int()
      .min(2)
      .max(12)
      .default(6)
      .describe(
        'Trailing N months used to compute the monthly growth rate (revenue metrics only — ignored for customer_count, which uses fixed-window L2 distributions). Default 6, range 2-12.',
      ),
  })
  .strict();

export function buildGoalEtaTool(_accountId: string, profile?: Profile) {
  return tool({
    description:
      "Estimates time to reach a target value at current trajectory. Output state: 'achieved' (target ≤ current), 'reachable' (months_to_target + target_eta_iso), 'unreachable' (declining/flat/too_distant). Use for \"when do I hit $100K MRR\", \"how long until 1,000 customers\". Inputs: metric (recurring_revenue|billed_revenue|direct_charge_revenue|customer_count), target_value (major units for revenue, raw count for customer_count), lookback_months (revenue only, 2-12, default 6). For `recurring_revenue`: `current_value` is latest trailing month (MRR flow); `current_l1_state_mrr` is the active-sub run-rate snapshot. Mirror the user's term. When the two differ >10%, surface both: \"Your MRR last month was $X, though active-subscription run-rate is closer to $Y.\" Otherwise use `current_value`.",
    inputSchema: GOAL_ETA_INPUT_SCHEMA,
    execute: async ({ metric, target_value, lookback_months }) => {
      try {
        if (metric === 'customer_count') {
          return goalEta({
            metric,
            target_value,
            current_count: profile?.layer1?.scale?.customer_count,
            new_customer_distribution: profile?.layer2?.new_customer_distribution,
            churn_distribution: profile?.layer2?.churn_distribution,
            now: new Date(),
          });
        }
        const series = seriesForMetric(profile, metric);
        return goalEta({
          metric,
          target_value,
          series,
          lookback_months,
          now: new Date(),
          l1_state_mrr: profile?.layer1?.scale?.mrr_amount,
        });
      } catch (err) {
        console.error('[ask] goal_eta tool execute() failed:', err);
        throw err;
      }
    },
  });
}
