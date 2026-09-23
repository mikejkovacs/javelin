import { tool } from 'ai';
import { z } from 'zod';
import { projectCustomerCount } from '../../metrics/projectCustomerCount';
import type { Profile } from '../../profile';

export const PROJECT_CUSTOMER_COUNT_INPUT_SCHEMA = z
  .object({
    horizon_months: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(3)
      .describe('How many months ahead to project. Default 3, range 1-12.'),
  })
  .strict();

export function buildProjectCustomerCountTool(
  _accountId: string,
  profile?: Profile,
) {
  return tool({
    description:
      "Projects customer count forward N months via linear extrapolation: monthly net additions = median(new) − median(churn) from trailing-6m. ASSUMES flat acquisition/churn — surface this when narrating (Rule #10). Use for 'where will customer count be'. Inputs: horizon_months (1-12, default 3).",
    inputSchema: PROJECT_CUSTOMER_COUNT_INPUT_SCHEMA,
    execute: async ({ horizon_months }) => {
      try {
        return projectCustomerCount({
          current_count: profile?.layer1?.scale?.customer_count,
          new_customer_distribution: profile?.layer2?.new_customer_distribution,
          churn_distribution: profile?.layer2?.churn_distribution,
          horizon_months,
          now: new Date(),
        });
      } catch (err) {
        console.error('[ask] project_customer_count tool execute() failed:', err);
        throw err;
      }
    },
  });
}
