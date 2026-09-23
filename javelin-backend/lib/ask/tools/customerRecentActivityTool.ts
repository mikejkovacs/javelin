import { tool } from 'ai';
import { z } from 'zod';
import { customerRecentActivity } from '../../metrics/customerRecentActivity';
import {
  retrieveCustomer,
  fetchCustomerCharges,
  fetchCustomerInvoices,
  fetchCustomerSubscriptions,
  fetchDisputesForCustomer,
  fetchCustomerSubscriptionUpdateEvents,
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

export const CUSTOMER_RECENT_ACTIVITY_INPUT_SCHEMA = z
  .object({
    customer_id: z
      .string()
      .regex(/^cus_/, 'customer_id must be a Stripe customer ID (cus_*)')
      .describe('Stripe customer ID; obtain from customer_lookup'),
    start: isoDate('start')
      .optional()
      .describe('Period start date, ISO YYYY-MM-DD; default trailing 90d when omitted'),
    end: isoDate('end')
      .optional()
      .describe('Period end date, ISO YYYY-MM-DD (inclusive); default today when omitted'),
  })
  .strict()
  .refine(
    (v) => (v.start === undefined) === (v.end === undefined),
    { message: 'start and end must both be provided, or both omitted' },
  );

const TRAILING_90D_SECONDS = 90 * 24 * 60 * 60;

export function buildCustomerRecentActivityTool(accountId: string) {
  return tool({
    description:
      'Returns chronological recent activity for one customer — charges, refunds, invoices, subscription create/cancel/plan-change, disputes — plus `upcoming_cancellations` for any subs with cancel_at_period_end. Call AFTER `customer_lookup` resolves a customer ID. Use for "did customer X churn", "did they upgrade/downgrade", "any failed charges recently". Default trailing 90 days; pass start/end ISO to override. Plan-change events limited to last 30 days (Stripe retention); when the events array is empty, narrate "no plan changes in the last 30 days" — never "I don\'t have access to history". Inputs: customer_id (cus_*), optional start/end ISO dates.',
    inputSchema: CUSTOMER_RECENT_ACTIVITY_INPUT_SCHEMA,
    execute: async ({ customer_id, start, end }) => {
      try {
        const stripe = getStripeClient();
        const now = new Date();
        const nowSec = Math.floor(now.getTime() / 1000);
        const period =
          start && end
            ? {
                start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
                end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
              }
            : {
                start: nowSec - TRAILING_90D_SECONDS,
                end: nowSec,
              };

        const customer = await retrieveCustomer(stripe, accountId, customer_id);
        if (!customer) {
          // Customer not found OR deleted. Return an empty result with a
          // synthetic "deleted/missing" customer shape so the LLM can
          // narrate gracefully ("That customer doesn't exist or was deleted")
          // instead of throwing.
          return customerRecentActivity({
            customer: {
              id: customer_id,
              name: null,
              email: null,
            } as unknown as import('stripe').default.Customer,
            charges: [],
            invoices: [],
            subscriptions: [],
            disputes: [],
            period,
            now,
            truncated: false,
          });
        }

        const [chargesResult, invoices, subscriptions, disputes, subscriptionUpdateEvents] =
          await Promise.all([
            fetchCustomerCharges(stripe, accountId, customer_id, period),
            fetchCustomerInvoices(stripe, accountId, customer_id, period),
            fetchCustomerSubscriptions(stripe, accountId, customer_id),
            fetchDisputesForCustomer(stripe, accountId, period),
            fetchCustomerSubscriptionUpdateEvents(
              stripe,
              accountId,
              customer_id,
              period,
            ),
          ]);

        return customerRecentActivity({
          customer,
          charges: chargesResult.charges,
          invoices,
          subscriptions,
          disputes,
          subscriptionUpdateEvents,
          period,
          now,
          truncated: chargesResult.truncated,
        });
      } catch (err) {
        console.error(
          '[ask] customer_recent_activity tool execute() failed:',
          err,
        );
        throw err;
      }
    },
  });
}
