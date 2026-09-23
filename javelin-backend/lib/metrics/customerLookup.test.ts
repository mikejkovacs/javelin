import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { customerLookup } from './customerLookup';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const APR_22 = Math.floor(Date.UTC(2026, 3, 22, 0, 0, 0) / 1000);
const MAR_22 = Math.floor(Date.UTC(2026, 2, 22, 0, 0, 0) / 1000);
const FEB_15 = Math.floor(Date.UTC(2026, 1, 15, 0, 0, 0) / 1000);
const AUG_01_2025 = Math.floor(Date.UTC(2025, 7, 1, 0, 0, 0) / 1000);
const DEC_01_2025 = Math.floor(Date.UTC(2025, 11, 1, 0, 0, 0) / 1000);
const JAN_15_2026 = Math.floor(Date.UTC(2026, 0, 15, 0, 0, 0) / 1000);

function customer(opts: {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  created: number;
}): Stripe.Customer {
  return {
    id: opts.id,
    object: 'customer',
    name: opts.name ?? null,
    email: opts.email ?? null,
    phone: opts.phone ?? null,
    created: opts.created,
  } as unknown as Stripe.Customer;
}

function charge(opts: {
  customer: string;
  amount: number;
  amount_refunded?: number;
  currency?: string;
  status?: 'succeeded' | 'failed';
  created: number;
}): Stripe.Charge {
  return {
    id: `ch_${Math.random().toString(36).slice(2, 8)}`,
    customer: opts.customer,
    amount: opts.amount,
    amount_refunded: opts.amount_refunded ?? 0,
    currency: opts.currency ?? 'usd',
    status: opts.status ?? 'succeeded',
    created: opts.created,
  } as unknown as Stripe.Charge;
}

describe('customer_lookup', () => {
  it('rolls up most_recent_charge_at + lifetime_collected per customer', () => {
    const r = customerLookup({
      customers: [
        customer({ id: 'cus_jr', name: 'Jenny Rosen', email: 'jenny@example.com', created: AUG_01_2025 }),
      ],
      charges: [
        charge({ customer: 'cus_jr', amount: 24500, created: APR_22 }),
        charge({ customer: 'cus_jr', amount: 24500, created: MAR_22 }),
      ],
      query: { name: 'Jenny Rosen' },
      match_strategy: 'exact_search',
      truncated: false,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].id).toBe('cus_jr');
    expect(r.rows[0].most_recent_charge_at).toBe(APR_22);
    // Pre-rendered ISO mirrors most_recent_charge_at (Joy Rowe round-2 fix).
    expect(r.rows[0].most_recent_charge_at_iso).toBe('2026-04-22');
    // Last-payment amount/currency populated separately from lifetime
    // (Joy Rowe round-3 fix).
    expect(r.rows[0].most_recent_charge_amount).toBe(245);
    expect(r.rows[0].most_recent_charge_currency).toBe('usd');
    expect(r.rows[0].lifetime_collected).toBe(490); // $245 × 2
    expect(r.rows[0].lifetime_currency).toBe('usd');
    expect(r.rows[0].display_name).toBe('Jenny Rosen');
  });

  it('most_recent_charge_amount is the literal last charge, not the lifetime total', () => {
    // Multi-charge customer with different amounts — last payment $50,
    // earlier payment $200; lifetime $250. The "what was the last payment"
    // surface ($50) must NOT be conflated with lifetime ($250).
    const r = customerLookup({
      customers: [customer({ id: 'cus_x', name: 'X', created: AUG_01_2025 })],
      charges: [
        charge({ customer: 'cus_x', amount: 5000, created: APR_22 }),
        charge({ customer: 'cus_x', amount: 20000, created: MAR_22 }),
      ],
      query: {},
      match_strategy: 'exact_search',
      truncated: false,
      now: NOW,
    });
    expect(r.rows[0].most_recent_charge_amount).toBe(50);
    expect(r.rows[0].lifetime_collected).toBe(250);
  });

  it('sorts by most_recent_charge_at desc — most-active customer first (Q9.1)', () => {
    const r = customerLookup({
      customers: [
        customer({ id: 'cus_jr', name: 'Jenny Rosen', created: AUG_01_2025 }),
        customer({ id: 'cus_js', name: 'Jenny Smith', created: DEC_01_2025 }),
      ],
      charges: [
        charge({ customer: 'cus_jr', amount: 24500, created: APR_22 }),
        charge({ customer: 'cus_js', amount: 10000, created: FEB_15 }),
      ],
      query: { name: 'Jenny' },
      match_strategy: 'prefix_fallback',
      truncated: false,
      now: NOW,
    });
    expect(r.rows.map((row) => row.id)).toEqual(['cus_jr', 'cus_js']);
  });

  it('display_name fallback chain mirrors Stripe Dashboard: name → individual_name → business_name → description → email', () => {
    // Helper to build a customer with arbitrary nullable fields including
    // the newer individual_name / business_name fields that aren't in the
    // tight `customer()` builder above.
    const cWithFields = (id: string, fields: Record<string, string | null>) =>
      ({
        id,
        object: 'customer',
        created: 0,
        name: null,
        email: null,
        phone: null,
        description: null,
        ...fields,
      }) as unknown as Stripe.Customer;

    const r = customerLookup({
      customers: [
        cWithFields('cus_name', { name: 'Has Name', email: 'a@b.com' }),
        cWithFields('cus_indiv', { individual_name: 'Indiv Name', email: 'b@c.com' }),
        cWithFields('cus_biz', { business_name: 'Acme Co', email: 'c@d.com' }),
        cWithFields('cus_desc', {
          description: 'Joy Rowe',
          email: 'joy.e.rowe@example.com',
        }),
        cWithFields('cus_email', { email: 'fallback@example.com' }),
        cWithFields('cus_neither', {}),
      ],
      charges: [],
      query: {},
      match_strategy: 'exact_search',
      truncated: false,
      now: NOW,
    });
    const byId = Object.fromEntries(r.rows.map((row) => [row.id, row]));
    expect(byId.cus_name.display_name).toBe('Has Name');
    expect(byId.cus_indiv.display_name).toBe('Indiv Name');
    expect(byId.cus_biz.display_name).toBe('Acme Co');
    // Joy Rowe finding — description-only-named customer surfaces by description.
    expect(byId.cus_desc.display_name).toBe('Joy Rowe');
    expect(byId.cus_email.display_name).toBe('fallback@example.com');
    expect(byId.cus_neither.display_name).toBe('an unnamed customer');
  });

  it('customers with no charges: most_recent_charge_at null, lifetime 0, currency null', () => {
    const r = customerLookup({
      customers: [
        customer({ id: 'cus_x', name: 'No Charges', created: AUG_01_2025 }),
      ],
      charges: [],
      query: { id: 'cus_x' },
      match_strategy: 'id_lookup',
      truncated: false,
      now: NOW,
    });
    expect(r.rows[0].most_recent_charge_at).toBeNull();
    expect(r.rows[0].most_recent_charge_at_iso).toBeNull();
    expect(r.rows[0].most_recent_charge_amount).toBeNull();
    expect(r.rows[0].most_recent_charge_currency).toBeNull();
    expect(r.rows[0].lifetime_collected).toBe(0);
    expect(r.rows[0].lifetime_currency).toBeNull();
  });

  it('multi-currency customer: lifetime_collected uses dominant currency by minor-unit total', () => {
    const r = customerLookup({
      customers: [
        customer({ id: 'cus_multi', name: 'Multi Currency', created: AUG_01_2025 }),
      ],
      charges: [
        charge({ customer: 'cus_multi', amount: 100000, currency: 'usd', created: APR_22 }), // $1,000 USD
        charge({ customer: 'cus_multi', amount: 50000, currency: 'cad', created: MAR_22 }),  // CA$500 — smaller minor total
      ],
      query: {},
      match_strategy: 'exact_search',
      truncated: false,
      now: NOW,
    });
    expect(r.rows[0].lifetime_currency).toBe('usd');
    expect(r.rows[0].lifetime_collected).toBe(1000);
  });

  it('skips failed and fully-refunded charges from lifetime aggregation', () => {
    const r = customerLookup({
      customers: [customer({ id: 'cus_x', name: 'X', created: AUG_01_2025 })],
      charges: [
        charge({ customer: 'cus_x', amount: 50000, created: APR_22 }),
        charge({ customer: 'cus_x', amount: 30000, status: 'failed', created: APR_22 }),
        charge({ customer: 'cus_x', amount: 10000, amount_refunded: 10000, created: APR_22 }),
      ],
      query: {},
      match_strategy: 'exact_search',
      truncated: false,
      now: NOW,
    });
    expect(r.rows[0].lifetime_collected).toBe(500);
  });

  it('charges from other customers do not pollute the rollup', () => {
    const r = customerLookup({
      customers: [customer({ id: 'cus_target', name: 'Target', created: AUG_01_2025 })],
      charges: [
        charge({ customer: 'cus_target', amount: 10000, created: APR_22 }),
        charge({ customer: 'cus_other', amount: 99999, created: APR_22 }),
      ],
      query: {},
      match_strategy: 'exact_search',
      truncated: false,
      now: NOW,
    });
    expect(r.rows[0].lifetime_collected).toBe(100);
  });

  it('match_strategy + truncated + query echo through to the result', () => {
    const r = customerLookup({
      customers: [],
      charges: [],
      query: { name: 'Nobody' },
      match_strategy: 'no_match',
      truncated: true,
      now: NOW,
    });
    expect(r.match_strategy).toBe('no_match');
    expect(r.truncated).toBe(true);
    expect(r.query).toEqual({ name: 'Nobody' });
    expect(r.rows).toEqual([]);
  });

  it('definition tag + as_of + table metadata populated', () => {
    const r = customerLookup({
      customers: [],
      charges: [],
      query: {},
      match_strategy: 'exact_search',
      truncated: false,
      now: NOW,
    });
    expect(r.definition).toBe('javelin_defined.customer_lookup');
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.table.columns).toHaveLength(4);
    expect(r.table.empty_label).toBe('No matching customer found');
  });
});
