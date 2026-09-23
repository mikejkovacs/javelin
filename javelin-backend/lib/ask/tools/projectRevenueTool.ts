import { tool } from 'ai';
import { z } from 'zod';
import { projectRevenue } from '../../metrics/projectRevenue';
import { seriesForMetric } from '../../metrics/seriesSelect';
import type { Profile } from '../../profile';

export const PROJECT_REVENUE_INPUT_SCHEMA = z
  .object({
    metric: z
      .enum(['recurring_revenue', 'billed_revenue', 'direct_charge_revenue'])
      .describe(
        'Which revenue metric to project. recurring_revenue = subscription billings (MRR proxy); billed_revenue = all invoiced revenue (recurring + non-recurring); direct_charge_revenue = one-time payments (charges with no invoice).',
      ),
    lookback_months: z
      .number()
      .int()
      .min(2)
      .max(12)
      .default(6)
      .describe(
        'Trailing N months used to compute the monthly growth rate. Default 6, range 2-12.',
      ),
    horizon_months: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(3)
      .describe(
        'How many months ahead to project. Default 3, range 1-12.',
      ),
  })
  .strict();

export function buildProjectRevenueTool(_accountId: string, profile?: Profile) {
  return tool({
    description:
      'Projects a revenue metric forward N months based on recent monthly trend. Use for "where will MRR be in 6 months", "project billed revenue". Inputs: metric (recurring_revenue|billed_revenue|direct_charge_revenue); lookback_months (2-12, default 6); horizon_months (1-12, default 3). **For `recurring_revenue` specifically:** `current_l1_state_mrr` is the canonical MRR — what active subscriptions bill per month right now. ALWAYS lead with this when present. `current_value` is the latest trailing-month BILLED FLOW which can be partial (e.g., mid-month) or near-zero on subscription gaps; use it ONLY for trend lines, NEVER as the headline current MRR figure. If you say "MRR would remain at zero" because `current_value` is small but `current_l1_state_mrr` is non-zero, that\'s WRONG — the run-rate is the real MRR. When the two differ materially, surface both: "Your active-subscription run-rate is $Y; trailing billed flow has been $X — projecting forward at the trend, you\'d land near $Z."',
    inputSchema: PROJECT_REVENUE_INPUT_SCHEMA,
    execute: async ({ metric, lookback_months, horizon_months }) => {
      try {
        const series = seriesForMetric(profile, metric);
        return projectRevenue({
          series,
          metric,
          lookback_months,
          horizon_months,
          now: new Date(),
          l1_state_mrr: profile?.layer1?.scale?.mrr_amount,
        });
      } catch (err) {
        console.error('[ask] project_revenue tool execute() failed:', err);
        throw err;
      }
    },
  });
}
