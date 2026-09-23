import { describe, it, expect } from 'vitest';
import { activeSubscriptionCount } from './activeSubscriptionCount';
import type {
  StripeSubscriptionLike,
  StripeSubscriptionItemLike,
} from './subscriptionEnriched';

const NOW = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

function sub(
  id: string,
  unit_amount: number,
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
      currency: 'usd',
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

describe('active_subscription_count', () => {
  it('empty input → 0', () => {
    const r = activeSubscriptionCount({ subscriptions: [], now: NOW });
    expect(r.value).toBe(0);
    expect(r.kind).toBe('scalar');
  });

  it('three active subs → 3', () => {
    const r = activeSubscriptionCount({
      subscriptions: [sub('a', 1000), sub('b', 2000), sub('c', 500)],
      now: NOW,
    });
    expect(r.value).toBe(3);
  });

  it('past_due counted, canceled and trialing not', () => {
    const r = activeSubscriptionCount({
      subscriptions: [
        sub('a', 1000, 'active'),
        sub('b', 1000, 'past_due'),
        sub('c', 1000, 'canceled'),
        sub('d', 1000, 'trialing', { trial_end: NOW_SEC + 86400 }),
      ],
      now: NOW,
    });
    expect(r.value).toBe(2);
  });

  it('paused (void) not counted', () => {
    const r = activeSubscriptionCount({
      subscriptions: [
        sub('a', 1000),
        sub('b', 1000, 'active', { pause_collection: { behavior: 'void' } }),
      ],
      now: NOW,
    });
    expect(r.value).toBe(1);
  });

  it('cross-currency subs all counted (count is currency-agnostic)', () => {
    const usd = sub('a', 1000);
    const eur = sub('b', 1000);
    eur.items.data[0].price.currency = 'eur';
    const r = activeSubscriptionCount({ subscriptions: [usd, eur], now: NOW });
    expect(r.value).toBe(2);
  });

  it('output envelope: scalar kind, count unit, definition + as_of', () => {
    const r = activeSubscriptionCount({ subscriptions: [sub('a', 1000)], now: NOW });
    expect(r.kind).toBe('scalar');
    expect(r.unit).toBe('count');
    expect(r.definition).toBe('javelin.active_subscription_count.v1');
    expect(r.as_of).toBe(NOW_SEC);
  });
});
