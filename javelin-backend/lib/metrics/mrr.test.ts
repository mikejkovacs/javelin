// MRR tests. Heavy fixtures live in subscriptionEnriched.test.ts; these focus on
// the aggregation step (per-currency bucketing, exclusion propagation).

import { describe, it, expect } from 'vitest';
import { mrr } from './mrr';
import type {
  StripeSubscriptionLike,
  StripeSubscriptionItemLike,
} from './subscriptionEnriched';

const NOW = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

function sub(
  id: string,
  unit_amount: number,
  currency = 'usd',
  status = 'active',
  extras: Partial<StripeSubscriptionLike> = {}
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
    ...extras,
  };
}

describe('mrr', () => {
  it('empty input → empty rows', () => {
    expect(mrr({ subscriptions: [], now: NOW }).rows).toEqual([]);
  });

  it('three USD active subs → single USD row, summed', () => {
    const r = mrr({
      subscriptions: [sub('a', 1000), sub('b', 2500), sub('c', 500)],
      now: NOW,
    });
    expect(r.rows).toEqual([{ currency: 'usd', mrr: 40, subscription_count: 3 }]);
  });

  it('USD + EUR → two rows, sorted by currency', () => {
    const r = mrr({
      subscriptions: [sub('a', 2000, 'usd'), sub('b', 5000, 'eur')],
      now: NOW,
    });
    expect(r.rows).toEqual([
      { currency: 'eur', mrr: 50, subscription_count: 1 },
      { currency: 'usd', mrr: 20, subscription_count: 1 },
    ]);
  });

  it('past_due included alongside active', () => {
    const r = mrr({
      subscriptions: [sub('a', 1000, 'usd', 'active'), sub('b', 2000, 'usd', 'past_due')],
      now: NOW,
    });
    expect(r.rows).toEqual([{ currency: 'usd', mrr: 30, subscription_count: 2 }]);
  });

  it('canceled and trialing excluded', () => {
    const r = mrr({
      subscriptions: [
        sub('a', 1000, 'usd', 'active'),
        sub('b', 99999, 'usd', 'canceled'),
        sub('c', 99999, 'usd', 'trialing', { trial_end: NOW_SEC + 86400 }),
      ],
      now: NOW,
    });
    expect(r.rows).toEqual([{ currency: 'usd', mrr: 10, subscription_count: 1 }]);
  });

  it('annual sub contributes 1/12 of raw', () => {
    const annual = sub('a', 12000, 'usd');
    annual.items.data[0].price.recurring = {
      interval: 'year', interval_count: 1, usage_type: 'licensed',
    };
    const r = mrr({ subscriptions: [annual], now: NOW });
    expect(r.rows[0].mrr).toBeCloseTo(10, 6);
    expect(r.rows[0].subscription_count).toBe(1);
  });

  it('output envelope: kind, definition, as_of', () => {
    const r = mrr({ subscriptions: [sub('a', 1000)], now: NOW });
    expect(r.kind).toBe('rows');
    expect(r.definition).toBe('stripe_billing_analytics_glossary.mrr');
    expect(r.as_of).toBe(NOW_SEC);
  });
});
