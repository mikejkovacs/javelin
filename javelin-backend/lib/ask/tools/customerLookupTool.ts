import { tool } from 'ai';
import { z } from 'zod';
import type Stripe from 'stripe';
import {
  customerLookup,
  type CustomerLookupMatchStrategy,
} from '../../metrics/customerLookup';
import {
  retrieveCustomer,
  searchCustomersByEmail,
  searchCustomersByName,
  fetchCustomersForPrefixMatch,
  fetchCustomerCharges,
} from '../fetchers';
import { getStripeClient } from '../stripeClient';

// Q1.2 hybrid name-search strategy. The primitive's `match_strategy`
// field records which path produced the rows so the LLM can hedge ("I
// fell back to a prefix search since the exact name didn't match").

export const CUSTOMER_LOOKUP_INPUT_SCHEMA = z
  .object({
    name: z.string().optional().describe('Customer name (full or partial)'),
    email: z.string().optional().describe('Customer email (exact)'),
    id: z
      .string()
      .optional()
      .describe('Stripe customer ID (cus_*); use when known'),
  })
  .strict()
  .refine(
    (v) => Boolean(v.name) || Boolean(v.email) || Boolean(v.id),
    { message: 'At least one of name, email, or id is required' },
  );

const LIFETIME_WINDOW_SECONDS = 365 * 5 * 24 * 60 * 60; // 5 years — covers most ICP merchants' lifetimes

export function buildCustomerLookupTool(accountId: string) {
  return tool({
    description:
      'Find a Stripe customer by name, email, or customer ID. Returns rows sorted by most recent activity. Name search: exact match then prefix-fallback. When multiple matches, present the most-recently-active first and disclose alternatives ("I assumed X — N others if you meant someone else"). Each row has `most_recent_charge_amount` + `most_recent_charge_currency` (last payment, distinct from `lifetime_collected`) and `most_recent_charge_at_iso` (use directly, do NOT convert from unix). For deeper activity (events, invoices, subscription changes) use `customer_recent_activity` after getting the id. Inputs: at least one of name, email, id.',
    inputSchema: CUSTOMER_LOOKUP_INPUT_SCHEMA,
    execute: async ({ name, email, id }) => {
      try {
        const stripe = getStripeClient();

        let customers: Stripe.Customer[] = [];
        let match_strategy: CustomerLookupMatchStrategy = 'no_match';
        let truncated = false;

        if (id) {
          const c = await retrieveCustomer(stripe, accountId, id);
          if (c) {
            customers = [c];
            match_strategy = 'id_lookup';
          }
        } else if (email) {
          customers = await searchCustomersByEmail(stripe, accountId, email);
          match_strategy = customers.length > 0 ? 'exact_search' : 'no_match';
        } else if (name) {
          customers = await searchCustomersByName(stripe, accountId, name);
          if (customers.length > 0) {
            match_strategy = 'exact_search';
          } else {
            // Q1.2 step 3b — prefix fallback
            const fallback = await fetchCustomersForPrefixMatch(
              stripe,
              accountId,
              name,
            );
            customers = fallback.matches;
            truncated = fallback.truncated;
            match_strategy = customers.length > 0 ? 'prefix_fallback' : 'no_match';
          }
        }

        // Enrich with lifetime_collected + most_recent_charge_at by fetching
        // each matched customer's charges in parallel, capped at 5 years
        // back. For typical 1-3 matches this is cheap; for many matches it
        // scales linearly with #matches.
        const now = new Date();
        const lifetimePeriod = {
          start: Math.floor(now.getTime() / 1000) - LIFETIME_WINDOW_SECONDS,
          end: Math.floor(now.getTime() / 1000),
        };
        const allCharges: Stripe.Charge[] = [];
        await Promise.all(
          customers.map(async (c) => {
            const { charges } = await fetchCustomerCharges(
              stripe,
              accountId,
              c.id,
              lifetimePeriod,
            );
            allCharges.push(...charges);
          }),
        );

        return customerLookup({
          customers,
          charges: allCharges,
          query: { name, email, id },
          match_strategy,
          truncated,
          now,
        });
      } catch (err) {
        console.error('[ask] customer_lookup tool execute() failed:', err);
        throw err;
      }
    },
  });
}
