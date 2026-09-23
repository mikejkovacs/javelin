// customer_lookup — find a Stripe customer by name, email, or id, and
// surface enough context for the LLM to disambiguate (most-recent activity,
// lifetime collected, display_name fallback).
//
// Definition tag: `javelin_defined.customer_lookup`. Lookup itself is
// Stripe-canonical (search API + retrieve API), but the disambiguation
// enrichment (lifetime_collected, most_recent_charge_at, display_name
// fallback) is Javelin-defined — Stripe doesn't surface these on the
// raw Customer object.
//
// Hybrid name-match strategy (Q1.2 from Chunk C kickoff):
//   1. id provided   → customers.retrieve(id)
//   2. email provided → customers.search?query=email:'X'
//   3. name provided →
//      a. customers.search?query=name:'X' (exact match per Stripe)
//      b. on 0 results: list customers (cap 1k) and prefix-match
//         case-insensitively on .name (handles "Jenn" → "Jenny Rosen"
//         which Stripe Search misses)
// The match_strategy field on the result records which path produced the
// rows so the LLM can hedge appropriately ("I tried an exact match first
// and fell back to a prefix search").
//
// Disambiguation sort (Q9.1): most_recent_charge_at desc, then created
// desc as a secondary sort. The "operator's Jenny" is usually the one
// they last did business with.

import type Stripe from 'stripe';
import type { Period, TableMetadata } from './types';
import { toMajor } from './types';

export type CustomerLookupMatchStrategy =
  | 'id_lookup'        // direct retrieve(id)
  | 'exact_search'     // Search API hit on name:'X' or email:'X'
  | 'prefix_fallback'  // Search returned 0 → fell back to client-side prefix match
  | 'no_match';        // exhausted all paths, returned empty

export interface CustomerLookupRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  created: number;
  /** Most recent succeeded charge for this customer; null when no charges.
   *  Unix seconds — kept for callers needing arithmetic. The LLM should
   *  prefer `most_recent_charge_at_iso` for narration to avoid date-math
   *  fabrication (Rule #6 surface; observed 2026-05-01 / Joy Rowe round 2). */
  most_recent_charge_at: number | null;
  /** ISO 'YYYY-MM-DD' UTC of the most recent charge; null when no charges.
   *  Pre-rendered so the LLM doesn't have to convert from unix seconds —
   *  fixed Joy Rowe round-2 finding where the LLM hallucinated dates
   *  ("late April" / "March 1" / "late December") for a Feb 27 charge. */
  most_recent_charge_at_iso: string | null;
  /** Net amount of the most recent succeeded charge for this customer
   *  (charge.amount − charge.amount_refunded), in major units. Null when
   *  no charges. Surfaced so "what was the last payment" questions can
   *  be answered from a single tool call without confusing the lifetime
   *  total ($3,244.50) with the actual last-payment amount (Joy Rowe
   *  round-3 finding 2026-05-01). */
  most_recent_charge_amount: number | null;
  /** ISO 4217 lowercase currency of the most recent charge. Null when no
   *  charges. */
  most_recent_charge_currency: string | null;
  /** Sum of (amount − amount_refunded) across this customer's succeeded
   *  charges, in the dominant currency (highest minor-unit total). */
  lifetime_collected: number;
  /** ISO 4217 lowercase; null when this customer has no charges. */
  lifetime_currency: string | null;
  /** Pre-rendered display name: name ?? email ?? 'an unnamed customer'.
   *  Mirrors customer_concentration's display_name pattern so callers and
   *  voice-rule guards behave consistently. */
  display_name: string;
}

export interface CustomerLookupResult {
  kind: 'rows';
  rows: CustomerLookupRow[];
  query: { name?: string; email?: string; id?: string };
  match_strategy: CustomerLookupMatchStrategy;
  /** True when prefix-fallback hit the customer-list pagination cap and
   *  may have missed valid matches further into the list. */
  truncated: boolean;
  table: TableMetadata;
  definition: 'javelin_defined.customer_lookup';
  as_of: number;
}

export interface CustomerLookupInput {
  customers: Stripe.Customer[];
  /** All succeeded charges for the merchant (filtered to lookup-relevant
   *  customers by the wrapper, OR the full unbounded list — primitive
   *  filters per-customer client-side). */
  charges: Stripe.Charge[];
  query: { name?: string; email?: string; id?: string };
  match_strategy: CustomerLookupMatchStrategy;
  truncated: boolean;
  now: Date;
}

const CUSTOMER_LOOKUP_TABLE: TableMetadata = {
  columns: [
    { field: 'display_name', label: 'Customer', align: 'left' },
    { field: 'email', label: 'Email', align: 'left' },
    {
      field: 'lifetime_collected',
      label: 'Lifetime',
      align: 'right',
      format: 'currency',
      currency_field: 'lifetime_currency',
    },
    {
      // Use the pre-rendered ISO string field — frontend formatter handles
      // strings via passthrough, so the table cell shows the same date the
      // LLM uses verbatim (Joy Rowe round-2 fix).
      field: 'most_recent_charge_at_iso',
      label: 'Last payment',
      align: 'right',
      format: 'date',
    },
  ],
  sort_default: { field: 'most_recent_charge_at', order: 'desc' },
  empty_label: 'No matching customer found',
};

function isoDateUTC(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function deriveDisplayName(customer: Stripe.Customer): string {
  // Mirror Stripe Dashboard's customer-name fallback chain so what the
  // user sees in Javelin matches what they see in Stripe's UI:
  //   name → individual_name → business_name → description → email
  // Hot-fix landed 2026-05-01 / Chunk C close — original chain was just
  // name → email, which fabricated identity for description-named
  // customers (Joy Rowe finding).
  const candidates: Array<string | null | undefined> = [
    customer.name,
    (customer as unknown as { individual_name?: string | null }).individual_name,
    (customer as unknown as { business_name?: string | null }).business_name,
    customer.description,
    customer.email,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return 'an unnamed customer';
}

interface PerCustomerCharge {
  most_recent_at: number | null;
  /** Net amount + currency of the single most-recent succeeded charge.
   *  Distinct from the dominant-currency lifetime sum — this is the
   *  literal last payment, used to answer "what was the last payment?"
   *  without conflating with lifetime_collected. */
  most_recent_amount_minor: number | null;
  most_recent_currency: string | null;
  by_currency: Map<string, number>; // currency → net minor units
}

function rollupChargesByCustomer(
  charges: Stripe.Charge[],
): Map<string, PerCustomerCharge> {
  const byCustomer = new Map<string, PerCustomerCharge>();
  for (const charge of charges) {
    if (charge.status !== 'succeeded') continue;
    if (!charge.customer) continue;
    const customerId =
      typeof charge.customer === 'string' ? charge.customer : charge.customer.id;
    const net_minor = charge.amount - charge.amount_refunded;
    if (net_minor <= 0) continue;
    const existing = byCustomer.get(customerId) ?? {
      most_recent_at: null,
      most_recent_amount_minor: null,
      most_recent_currency: null,
      by_currency: new Map(),
    };
    if (existing.most_recent_at === null || charge.created > existing.most_recent_at) {
      existing.most_recent_at = charge.created;
      existing.most_recent_amount_minor = net_minor;
      existing.most_recent_currency = charge.currency.toLowerCase();
    }
    const currency = charge.currency.toLowerCase();
    existing.by_currency.set(
      currency,
      (existing.by_currency.get(currency) ?? 0) + net_minor,
    );
    byCustomer.set(customerId, existing);
  }
  return byCustomer;
}

function dominantCurrency(
  by_currency: Map<string, number>,
): { currency: string; minor: number } | null {
  let dominant: { currency: string; minor: number } | null = null;
  for (const [currency, minor] of by_currency) {
    if (!dominant || minor > dominant.minor) {
      dominant = { currency, minor };
    }
  }
  return dominant;
}

export function customerLookup(input: CustomerLookupInput): CustomerLookupResult {
  const { customers, charges, query, match_strategy, truncated, now } = input;

  const chargesByCustomer = rollupChargesByCustomer(charges);

  const rows: CustomerLookupRow[] = customers.map((customer) => {
    const enrichment = chargesByCustomer.get(customer.id);
    const dominant = enrichment ? dominantCurrency(enrichment.by_currency) : null;
    const most_recent_at = enrichment?.most_recent_at ?? null;
    const most_recent_amount_minor = enrichment?.most_recent_amount_minor ?? null;
    const most_recent_currency = enrichment?.most_recent_currency ?? null;
    return {
      id: customer.id,
      name: customer.name ?? null,
      email: customer.email ?? null,
      phone: customer.phone ?? null,
      created: customer.created,
      most_recent_charge_at: most_recent_at,
      most_recent_charge_at_iso: most_recent_at !== null ? isoDateUTC(most_recent_at) : null,
      most_recent_charge_amount:
        most_recent_amount_minor !== null && most_recent_currency !== null
          ? toMajor(most_recent_amount_minor, most_recent_currency)
          : null,
      most_recent_charge_currency: most_recent_currency,
      lifetime_collected: dominant ? toMajor(dominant.minor, dominant.currency) : 0,
      lifetime_currency: dominant ? dominant.currency : null,
      display_name: deriveDisplayName(customer),
    };
  });

  // Sort: most_recent_charge_at desc (nulls last), then created desc.
  rows.sort((a, b) => {
    const aRecent = a.most_recent_charge_at ?? -Infinity;
    const bRecent = b.most_recent_charge_at ?? -Infinity;
    if (aRecent !== bRecent) return bRecent - aRecent;
    return b.created - a.created;
  });

  return {
    kind: 'rows',
    rows,
    query,
    match_strategy,
    truncated,
    table: CUSTOMER_LOOKUP_TABLE,
    definition: 'javelin_defined.customer_lookup',
    as_of: Math.floor(now.getTime() / 1000),
  };
}
