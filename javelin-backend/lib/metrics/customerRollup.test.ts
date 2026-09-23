import { describe, it, expect } from 'vitest';
import { customerRollup, type StripeCustomerLike } from './customerRollup';
import type { ChargeEnrichedRow } from './chargeEnriched';
import type { SubscriptionEnrichedRow } from './subscriptionEnriched';

const NOW = new Date(Date.UTC(2026, 3, 22, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

function makeCustomer(o: Partial<StripeCustomerLike> = {}): StripeCustomerLike {
  return {
    id: o.id ?? 'cus_test',
    name: o.name === undefined ? 'Test Customer' : o.name,
    email: o.email === undefined ? 'test@example.com' : o.email,
    created: o.created ?? NOW_SEC - 86400 * 365,
    deleted: o.deleted,
  };
}

function makeCharge(o: Partial<ChargeEnrichedRow> = {}): ChargeEnrichedRow {
  return {
    charge_id: o.charge_id ?? 'ch_test',
    customer_id: o.customer_id === undefined ? 'cus_test' : o.customer_id,
    amount: o.amount ?? 100,
    amount_refunded: o.amount_refunded ?? 0,
    net_collected: o.net_collected ?? 100,
    currency: o.currency ?? 'usd',
    status: o.status ?? 'succeeded',
    created_at: o.created_at ?? NOW_SEC - 86400,
    card_brand: o.card_brand === undefined ? 'visa' : o.card_brand,
    card_country: o.card_country === undefined ? 'US' : o.card_country,
    billing_country: o.billing_country === undefined ? null : o.billing_country,
    disputed: o.disputed ?? false,
    refunded: o.refunded ?? false,
    fee: o.fee === undefined ? 3 : o.fee,
    net: o.net === undefined ? 97 : o.net,
    is_fraudulent: o.is_fraudulent ?? false,
  };
}

function makeSub(o: Partial<SubscriptionEnrichedRow> = {}): SubscriptionEnrichedRow {
  return {
    subscription_id: o.subscription_id ?? 'sub_test',
    customer_id: o.customer_id === undefined ? 'cus_test' : o.customer_id,
    status: o.status ?? 'active',
    monthly_normalized_amount: o.monthly_normalized_amount ?? 25,
    raw_amount: o.raw_amount ?? 25,
    currency: o.currency ?? 'usd',
    interval: o.interval ?? 'month',
    interval_count: o.interval_count ?? 1,
    plan_name: o.plan_name ?? 'Pro',
    product_id: o.product_id ?? 'prod_pro',
    price_id: o.price_id ?? 'price_pro',
    started_at: o.started_at ?? NOW_SEC - 86400 * 90,
    canceled_at: o.canceled_at === undefined ? null : o.canceled_at,
    ended_at: o.ended_at === undefined ? null : o.ended_at,
    cancellation_reason: o.cancellation_reason === undefined ? null : o.cancellation_reason,
    pause_collection_behavior:
      o.pause_collection_behavior === undefined ? null : o.pause_collection_behavior,
    contributes_to_mrr: o.contributes_to_mrr ?? true,
  };
}

describe('customerRollup — basics', () => {
  it('empty input → empty rows', () => {
    const r = customerRollup({ customers: [], charges: [], subscriptions: [], now: NOW });
    expect(r.rows).toEqual([]);
  });

  it('customer with no charges, no subs → all-null derived fields', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [],
      subscriptions: [],
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.first_charge_at).toBeNull();
    expect(row.last_charge_at).toBeNull();
    expect(row.card_country).toBeNull();
    expect(row.lifetime_collected).toBe(0);
    expect(row.lifetime_collected_currency).toBeNull();
    expect(row.current_mrr).toBe(0);
    expect(row.mrr_currency).toBeNull();
    expect(row.subscriptions).toEqual([]);
    expect(row.subscription_count).toBe(0);
  });

  it('excludes deleted customers', () => {
    const r = customerRollup({
      customers: [
        makeCustomer({ id: 'cus_live' }),
        makeCustomer({ id: 'cus_dead', deleted: true }),
      ],
      charges: [],
      subscriptions: [],
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].customer_id).toBe('cus_live');
  });

  it('preserves customer scalar fields verbatim', () => {
    const r = customerRollup({
      customers: [
        makeCustomer({ id: 'cus_a', name: 'Acme', email: 'a@b.co', created: 1700000000 }),
      ],
      charges: [],
      subscriptions: [],
      now: NOW,
    });
    expect(r.rows[0].name).toBe('Acme');
    expect(r.rows[0].email).toBe('a@b.co');
    expect(r.rows[0].created_at).toBe(1700000000);
  });

  it('handles null name/email without erroring', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a', name: null, email: null })],
      charges: [],
      subscriptions: [],
      now: NOW,
    });
    expect(r.rows[0].name).toBeNull();
    expect(r.rows[0].email).toBeNull();
  });
});

describe('customerRollup — charge-derived fields', () => {
  it('first_charge_at = earliest succeeded charge; last_charge_at = latest', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [
        makeCharge({ charge_id: 'c1', customer_id: 'cus_a', created_at: NOW_SEC - 86400 * 100 }),
        makeCharge({ charge_id: 'c2', customer_id: 'cus_a', created_at: NOW_SEC - 86400 * 50 }),
        makeCharge({ charge_id: 'c3', customer_id: 'cus_a', created_at: NOW_SEC - 86400 }),
      ],
      subscriptions: [],
      now: NOW,
    });
    expect(r.rows[0].first_charge_at).toBe(NOW_SEC - 86400 * 100);
    expect(r.rows[0].last_charge_at).toBe(NOW_SEC - 86400);
  });

  it('ignores failed/pending charges for first/last/lifetime', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [
        makeCharge({ charge_id: 'c1', customer_id: 'cus_a', status: 'failed', created_at: NOW_SEC - 86400 * 100, net_collected: 999 }),
        makeCharge({ charge_id: 'c2', customer_id: 'cus_a', status: 'pending', created_at: NOW_SEC - 86400 * 50, net_collected: 999 }),
        makeCharge({ charge_id: 'c3', customer_id: 'cus_a', status: 'succeeded', created_at: NOW_SEC - 86400, net_collected: 25 }),
      ],
      subscriptions: [],
      now: NOW,
    });
    expect(r.rows[0].first_charge_at).toBe(NOW_SEC - 86400);
    expect(r.rows[0].last_charge_at).toBe(NOW_SEC - 86400);
    expect(r.rows[0].lifetime_collected).toBe(25);
  });

  it('lifetime_collected sums net_collected for succeeded charges', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [
        makeCharge({ charge_id: 'c1', customer_id: 'cus_a', net_collected: 100 }),
        makeCharge({ charge_id: 'c2', customer_id: 'cus_a', net_collected: 50 }),
        makeCharge({ charge_id: 'c3', customer_id: 'cus_a', net_collected: 25 }),
      ],
      subscriptions: [],
      now: NOW,
    });
    expect(r.rows[0].lifetime_collected).toBe(175);
    expect(r.rows[0].lifetime_collected_currency).toBe('usd');
  });

  it('lifetime_collected picks highest-total currency for multi-currency customers', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [
        makeCharge({ charge_id: 'c1', customer_id: 'cus_a', currency: 'usd', net_collected: 100 }),
        makeCharge({ charge_id: 'c2', customer_id: 'cus_a', currency: 'eur', net_collected: 250 }),
      ],
      subscriptions: [],
      now: NOW,
    });
    expect(r.rows[0].lifetime_collected).toBe(250);
    expect(r.rows[0].lifetime_collected_currency).toBe('eur');
  });

  it('card_country = most-recent succeeded charge with non-null country', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [
        makeCharge({ charge_id: 'c1', customer_id: 'cus_a', card_country: 'CA', created_at: NOW_SEC - 86400 * 30 }),
        makeCharge({ charge_id: 'c2', customer_id: 'cus_a', card_country: 'US', created_at: NOW_SEC - 86400 }),
        makeCharge({ charge_id: 'c3', customer_id: 'cus_a', card_country: null, created_at: NOW_SEC - 3600 }),
      ],
      subscriptions: [],
      now: NOW,
    });
    expect(r.rows[0].card_country).toBe('US');
  });

  it('charges with null customer_id are ignored (no orphan attribution)', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [
        makeCharge({ charge_id: 'c1', customer_id: null, net_collected: 999 }),
      ],
      subscriptions: [],
      now: NOW,
    });
    expect(r.rows[0].lifetime_collected).toBe(0);
    expect(r.rows[0].first_charge_at).toBeNull();
  });
});

describe('customerRollup — subscription-derived fields', () => {
  it('subscriptions array preserves all subs (any state) per customer', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [],
      subscriptions: [
        makeSub({ subscription_id: 's1', customer_id: 'cus_a', status: 'active', plan_name: 'Pro' }),
        makeSub({ subscription_id: 's2', customer_id: 'cus_a', status: 'canceled', plan_name: 'Basic', contributes_to_mrr: false, monthly_normalized_amount: 0 }),
      ],
      now: NOW,
    });
    expect(r.rows[0].subscriptions).toHaveLength(2);
    expect(r.rows[0].subscription_count).toBe(2);
    expect(r.rows[0].subscriptions.map((s) => s.status)).toEqual(['active', 'canceled']);
  });

  it('current_mrr sums only contributing subs', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [],
      subscriptions: [
        makeSub({ subscription_id: 's1', customer_id: 'cus_a', monthly_normalized_amount: 30, contributes_to_mrr: true }),
        makeSub({ subscription_id: 's2', customer_id: 'cus_a', monthly_normalized_amount: 0, contributes_to_mrr: false, status: 'canceled' }),
      ],
      now: NOW,
    });
    expect(r.rows[0].current_mrr).toBe(30);
    expect(r.rows[0].mrr_currency).toBe('usd');
  });

  it('current_mrr picks highest-total currency for multi-currency subs', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [],
      subscriptions: [
        makeSub({ subscription_id: 's1', customer_id: 'cus_a', currency: 'usd', monthly_normalized_amount: 25 }),
        makeSub({ subscription_id: 's2', customer_id: 'cus_a', currency: 'eur', monthly_normalized_amount: 80 }),
      ],
      now: NOW,
    });
    expect(r.rows[0].current_mrr).toBe(80);
    expect(r.rows[0].mrr_currency).toBe('eur');
  });

  it('customer with subs but no contributing subs → current_mrr = 0, mrr_currency null', () => {
    const r = customerRollup({
      customers: [makeCustomer({ id: 'cus_a' })],
      charges: [],
      subscriptions: [
        makeSub({ customer_id: 'cus_a', status: 'canceled', contributes_to_mrr: false, monthly_normalized_amount: 0 }),
      ],
      now: NOW,
    });
    expect(r.rows[0].current_mrr).toBe(0);
    expect(r.rows[0].mrr_currency).toBeNull();
    expect(r.rows[0].subscription_count).toBe(1);
  });
});

describe('customerRollup — multi-customer + envelope', () => {
  it('rows correspond to customers; cross-customer charges/subs do not bleed', () => {
    const r = customerRollup({
      customers: [
        makeCustomer({ id: 'cus_a' }),
        makeCustomer({ id: 'cus_b' }),
      ],
      charges: [
        makeCharge({ customer_id: 'cus_a', net_collected: 100 }),
        makeCharge({ customer_id: 'cus_b', net_collected: 50 }),
      ],
      subscriptions: [
        makeSub({ customer_id: 'cus_a', monthly_normalized_amount: 25 }),
      ],
      now: NOW,
    });
    expect(r.rows).toHaveLength(2);
    const a = r.rows.find((x) => x.customer_id === 'cus_a')!;
    const b = r.rows.find((x) => x.customer_id === 'cus_b')!;
    expect(a.lifetime_collected).toBe(100);
    expect(a.subscription_count).toBe(1);
    expect(b.lifetime_collected).toBe(50);
    expect(b.subscription_count).toBe(0);
  });

  it('envelope: kind, definition, as_of', () => {
    const r = customerRollup({ customers: [makeCustomer()], charges: [], subscriptions: [], now: NOW });
    expect(r.kind).toBe('rows');
    expect(r.definition).toBe('javelin.customer_rollup.v1');
    expect(r.as_of).toBe(NOW_SEC);
  });
});
