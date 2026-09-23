import { tool } from 'ai';
import { z } from 'zod';
import { growthAttribution } from '../../metrics/growthAttribution';
import type { StripeCustomerLike } from '../../metrics/mrrMovement';
import type { StripeInvoiceLike } from '../../metrics/invoiceEnriched';
import type { StripeSubscriptionLike } from '../../metrics/subscriptionEnriched';
import type { StripeProductLike } from '../../metrics/revenueByPlan';
import {
  fetchInvoices,
  fetchActiveSubscriptions,
  fetchCanceledSubscriptions,
  fetchProducts,
  fetchCustomers,
} from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const GROWTH_ATTRIBUTION_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
  })
  .strict();

export function buildGrowthAttributionTool(accountId: string) {
  return tool({
    description:
      // Cross-pointer disambiguation (Q4=4C): name mrr_movement explicitly so the
      // LLM can pick the right tool. growth_attribution answers "where is growth
      // coming from?" by decomposing per plan. Scope is subscription MRR ONLY —
      // does NOT include one-off charges or non-subscription invoices; signaled
      // by envelope `scope:'subscription_mrr'` so the LLM can clarify when
      // narrating.
      'Attributes MRR CHANGES to specific plans, answering "where is growth coming from?" / "what plans are growing?". Per-plan decomposition of new / expansion / contraction / churned MRR with net contribution and share-of-period-net per plan. Sibling to `mrr_movement` (which gives bucket totals across plans + per-event drill-down); use `growth_attribution` when the user wants the plan-level cut. SCOPE: Stripe subscription billing only — recurring lines, plan changes, prorations, cancellations through Stripe Subscriptions. Does NOT include one-off charges, manual non-subscription invoices, or recurring revenue managed outside Stripe Billing. Top 20 (plan, currency) rows by absolute net contribution; tail collapsed into "Other (N plans)" per currency. Multi-currency: per-(plan, currency) rows; no FX. Uses invoice history (multi-year retention) — works for any time window. Inputs: start/end ISO.',
    inputSchema: GROWTH_ATTRIBUTION_INPUT_SCHEMA,
    execute: async ({ start, end }) => {
      try {
        const stripe = getStripeClient();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        const [invoices, activeSubscriptions, canceledSubscriptions, products, customers] =
          await Promise.all([
            fetchInvoices(stripe, accountId, period),
            fetchActiveSubscriptions(stripe, accountId),
            fetchCanceledSubscriptions(stripe, accountId, period),
            fetchProducts(stripe, accountId),
            fetchCustomers(stripe, accountId),
          ]);
        return growthAttribution({
          invoices: invoices as unknown as StripeInvoiceLike[],
          activeSubscriptions: activeSubscriptions as unknown as StripeSubscriptionLike[],
          canceledSubscriptions: canceledSubscriptions as unknown as StripeSubscriptionLike[],
          products: products as unknown as StripeProductLike[],
          customers: customers as unknown as StripeCustomerLike[],
          period,
          now: new Date(),
        });
      } catch (err) {
        console.error('[ask] growth_attribution tool execute() failed:', err);
        throw err;
      }
    },
  });
}
