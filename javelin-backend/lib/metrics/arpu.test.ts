import { describe, it, expect } from 'vitest';
import { arpu } from './arpu';
import type {
  StripeSubscriptionLike,
  StripeSubscriptionItemLike,
} from './subscriptionEnriched';
import type { StripeChargeLike } from './chargeEnriched';

const NOW = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const PERIOD = { start: NOW_SEC - 86400 * 30, end: NOW_SEC };

function sub(
  id: string,
  unit_amount: number,
  currency = 'usd',
  status = 'active',
): StripeSubscriptionLike {
  const item: StripeSubscriptionItemLike = {
    id: `si_${id}`,
    quantity: 1,
    discounts: null,
    price: {
      id: `price_${id}`,
      nickname: null,
      unit_amount,
      currency,
      product: { id: 'prod_x', name: 'X' },
      recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    },
  };
  return {
    id,
    customer: `cus_${id}`,
    status,
    start_date: NOW_SEC - 86400 * 30,
    canceled_at: null,
    ended_at: null,
    cancellation_details: null,
    pause_collection: null,
    trial_end: null,
    discounts: null,
    items: { data: [item] },
  };
}

function charge(
  id: string,
  customer: string | null,
  amount: number,
  created = NOW_SEC - 86400,
  fraud: 'user' | 'stripe' | null = null,
): StripeChargeLike {
  return {
    id,
    customer,
    amount,
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    created,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    fraud_details:
      fraud === 'user'
        ? { user_report: 'fraudulent', stripe_report: null }
        : fraud === 'stripe'
          ? { user_report: null, stripe_report: 'fraudulent' }
          : null,
  };
}

describe('arpu — recurring basis', () => {
  it('MRR ÷ active subscription count', () => {
    const r = arpu({
      basis: 'recurring',
      subscriptions: [sub('a', 1000), sub('b', 2500), sub('c', 500)],
      now: NOW,
    });
    // MRR = 40, sub count = 3 → 13.333...
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].currency).toBe('usd');
    expect(r.rows[0].arpu).toBeCloseTo(40 / 3, 5);
    expect(r.rows[0].source_revenue).toBeCloseTo(40, 5);
    expect(r.rows[0].customer_count).toBe(3);
    expect(r.rows[0].basis).toBe('recurring');
    expect(r.rows[0].low_sample).toBe(true);
  });

  it('multi-currency: per-currency MRR ÷ global sub count', () => {
    const r = arpu({
      basis: 'recurring',
      subscriptions: [
        sub('a', 1000, 'usd'),
        sub('b', 2000, 'usd'),
        sub('c', 5000, 'eur'),
      ],
      now: NOW,
    });
    expect(r.rows).toHaveLength(2);
    const usd = r.rows.find((row) => row.currency === 'usd')!;
    const eur = r.rows.find((row) => row.currency === 'eur')!;
    expect(usd.arpu).toBeCloseTo(30 / 3, 5);
    expect(eur.arpu).toBeCloseTo(50 / 3, 5);
    expect(usd.customer_count).toBe(3);
    expect(eur.customer_count).toBe(3);
  });

  it('low_sample=false at >= 10 subs', () => {
    const subs = Array.from({ length: 10 }, (_, i) => sub(`s${i}`, 1000));
    const r = arpu({ basis: 'recurring', subscriptions: subs, now: NOW });
    expect(r.rows[0].low_sample).toBe(false);
  });

  it('zero subs → single row arpu=0, low_sample=true, currency=unknown', () => {
    const r = arpu({ basis: 'recurring', subscriptions: [], now: NOW });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].arpu).toBe(0);
    expect(r.rows[0].customer_count).toBe(0);
    expect(r.rows[0].low_sample).toBe(true);
    expect(r.rows[0].currency).toBe('unknown');
  });

  it('envelope: definition, basis, period=null, kind', () => {
    const r = arpu({
      basis: 'recurring',
      subscriptions: [sub('a', 1000)],
      now: NOW,
    });
    expect(r.kind).toBe('rows');
    expect(r.definition).toBe('javelin_defined.arpu');
    expect(r.basis).toBe('recurring');
    expect(r.period).toBeNull();
    expect(r.as_of).toBe(NOW_SEC);
  });
});

describe('arpu — collected basis', () => {
  it('collected_revenue ÷ paying_customer_count', () => {
    const r = arpu({
      basis: 'collected',
      charges: [
        charge('c1', 'cus_1', 10000),
        charge('c2', 'cus_2', 20000),
        charge('c3', 'cus_3', 5000),
      ],
      balanceTransactions: [],
      period: PERIOD,
      now: NOW,
    });
    // collected = 350, customers = 3 → 116.66...
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].arpu).toBeCloseTo(350 / 3, 5);
    expect(r.rows[0].source_revenue).toBeCloseTo(350, 5);
    expect(r.rows[0].customer_count).toBe(3);
    expect(r.rows[0].basis).toBe('collected');
  });

  it('dedupes customer count across charges', () => {
    const r = arpu({
      basis: 'collected',
      charges: [
        charge('c1', 'cus_1', 10000),
        charge('c2', 'cus_1', 5000), // same customer
        charge('c3', 'cus_2', 20000),
      ],
      balanceTransactions: [],
      period: PERIOD,
      now: NOW,
    });
    // collected = 350, customers = 2
    expect(r.rows[0].customer_count).toBe(2);
    expect(r.rows[0].arpu).toBeCloseTo(350 / 2, 5);
  });

  it('zero customers → arpu=0, low_sample=true', () => {
    const r = arpu({
      basis: 'collected',
      charges: [],
      balanceTransactions: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].arpu).toBe(0);
    expect(r.rows[0].low_sample).toBe(true);
  });

  it('envelope: period echoed, basis=collected', () => {
    const r = arpu({
      basis: 'collected',
      charges: [charge('c1', 'cus_1', 10000)],
      balanceTransactions: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.basis).toBe('collected');
    expect(r.period).toEqual(PERIOD);
  });
});
