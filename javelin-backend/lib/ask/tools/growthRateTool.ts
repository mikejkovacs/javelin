import { tool } from 'ai';
import { z } from 'zod';
import { growthRate } from '../../metrics/growthRate';
import { seriesForMetric } from '../../metrics/seriesSelect';
import type { Profile } from '../../profile';

export const GROWTH_RATE_INPUT_SCHEMA = z
  .object({
    metric: z
      .enum(['recurring_revenue', 'billed_revenue', 'direct_charge_revenue'])
      .describe(
        'Which revenue metric to compute growth for. recurring_revenue = subscription billings (MRR proxy); billed_revenue = all invoiced revenue (recurring + non-recurring); direct_charge_revenue = one-time payments (charges with no invoice).',
      ),
    window: z
      .number()
      .int()
      .min(2)
      .max(12)
      .default(6)
      .describe('Trailing N months to compute growth over. Default 6, range 2-12.'),
  })
  .strict();

export function buildGrowthRateTool(_accountId: string, profile?: Profile) {
  return tool({
    description:
      'Returns trailing-N-month growth-rate series for revenue metrics. Output: monthly MoM growth percentages, average growth rate, trend label (accelerating/decelerating/declining/flat). Use for "is revenue growing", "MRR growth rate", "is growth accelerating". Pick metric: recurring_revenue (subs/MRR), direct_charge_revenue (one-time-heavy businesses), billed_revenue (invoice-side); call multiple for ambiguous "revenue growth" on hybrid businesses. Single-currency (account default). Profile-sourced. Inputs: metric (required); window in months (default 6, range 2-12). Don\'t also call dimensional tools (revenue_by_country, revenue_by_plan) unless the user explicitly asked for the breakdown.',
    inputSchema: GROWTH_RATE_INPUT_SCHEMA,
    execute: async ({ metric, window }) => {
      try {
        const series = seriesForMetric(profile, metric);
        return growthRate({
          series,
          metric,
          window,
          now: new Date(),
        });
      } catch (err) {
        console.error('[ask] growth_rate tool execute() failed:', err);
        throw err;
      }
    },
  });
}
