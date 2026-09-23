import { describe, it, expect } from 'vitest';
import { churnCount } from './churnCount';
import type {
  StripeSubscriptionLike,
  StripeSubscriptionItemLike,
} from './subscriptionEnriched';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0)); // 2026-04-29
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const PERIOD_MARCH_2026 = {
  start: Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};

function canceledSub(
  id: string,
  ended_at: number | null,
  reason: string | null,
  status = 'canceled',
): StripeSubscriptionLike {
  const item: StripeSubscriptionItemLike = {
    id: `si_${id}`,
    quantity: 1,
    discounts: null,
    price: {
      id: `price_${id}`,
      nickname: null,
      unit_amount: 1000,
      currency: 'usd',
      product: { id: 'prod_x', name: 'X' },
      recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    },
  };
  return {
    id,
    customer: `cus_${id}`,
    status,
    start_date: NOW_SEC - 86400 * 365,
    canceled_at: ended_at,
    ended_at,
    cancellation_details: reason === undefined ? null : { reason },
    pause_collection: null,
    trial_end: null,
    discounts: null,
    items: { data: [item] },
  };
}

const MAR_05 = Math.floor(Date.UTC(2026, 2, 5, 0, 0, 0) / 1000);
const MAR_15 = Math.floor(Date.UTC(2026, 2, 15, 0, 0, 0) / 1000);
const MAR_25 = Math.floor(Date.UTC(2026, 2, 25, 0, 0, 0) / 1000);
const FEB_15 = Math.floor(Date.UTC(2026, 1, 15, 0, 0, 0) / 1000);
const APR_05 = Math.floor(Date.UTC(2026, 3, 5, 0, 0, 0) / 1000);

describe('churn_count', () => {
  it('happy path: one of each reason → totals + too_few breakdown', () => {
    const r = churnCount({
      subscriptions: [
        canceledSub('a', MAR_05, 'cancellation_requested'),
        canceledSub('b', MAR_15, 'payment_failed'),
        canceledSub('c', MAR_25, 'payment_disputed'),
        canceledSub('d', MAR_05, null),
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value).toEqual({
      total: 4,
      voluntary: 1,
      involuntary: 1,
      other: 1,
      unknown: 1,
    });
    expect(r.breakdown_significance).toBe('too_few');
  });

  it('canceled_by_retention_policy buckets as voluntary', () => {
    const r = churnCount({
      subscriptions: [
        canceledSub('a', MAR_05, 'cancellation_requested'),
        canceledSub('b', MAR_15, 'canceled_by_retention_policy'),
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.voluntary).toBe(2);
    expect(r.value.total).toBe(2);
  });

  it('date filter: ended_at outside period → excluded', () => {
    const r = churnCount({
      subscriptions: [
        canceledSub('a', MAR_15, 'cancellation_requested'),
        canceledSub('b', FEB_15, 'cancellation_requested'),
        canceledSub('c', APR_05, 'cancellation_requested'),
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.total).toBe(1);
    expect(r.value.voluntary).toBe(1);
  });

  it('defensive: unrecognized future enum value → unknown', () => {
    const r = churnCount({
      subscriptions: [
        canceledSub('a', MAR_05, 'rate_limited' as string), // hypothetical future value
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.unknown).toBe(1);
    expect(r.value.total).toBe(1);
  });

  it('defensive: ended_at = null → excluded even if status is canceled', () => {
    const r = churnCount({
      subscriptions: [canceledSub('a', null, 'cancellation_requested')],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.total).toBe(0);
  });

  it('empty input → all zeros, too_few', () => {
    const r = churnCount({
      subscriptions: [],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value).toEqual({
      total: 0,
      voluntary: 0,
      involuntary: 0,
      other: 0,
      unknown: 0,
    });
    expect(r.breakdown_significance).toBe('too_few');
  });

  it('single_bucket: 5 subs all payment_failed → single_bucket', () => {
    const r = churnCount({
      subscriptions: [
        canceledSub('a', MAR_05, 'payment_failed'),
        canceledSub('b', MAR_15, 'payment_failed'),
        canceledSub('c', MAR_25, 'payment_failed'),
        canceledSub('d', MAR_05, 'payment_failed'),
        canceledSub('e', MAR_15, 'payment_failed'),
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.total).toBe(5);
    expect(r.value.involuntary).toBe(5);
    expect(r.breakdown_significance).toBe('single_bucket');
  });

  it('meaningful: 6 subs split across buckets', () => {
    const r = churnCount({
      subscriptions: [
        canceledSub('a', MAR_05, 'cancellation_requested'),
        canceledSub('b', MAR_15, 'cancellation_requested'),
        canceledSub('c', MAR_25, 'canceled_by_retention_policy'),
        canceledSub('d', MAR_05, 'payment_failed'),
        canceledSub('e', MAR_15, 'payment_failed'),
        canceledSub('f', MAR_25, 'payment_disputed'),
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value).toEqual({
      total: 6,
      voluntary: 3,
      involuntary: 2,
      other: 1,
      unknown: 0,
    });
    expect(r.breakdown_significance).toBe('meaningful');
  });

  it('output envelope: scalar kind, count unit, definition + as_of + period', () => {
    const r = churnCount({
      subscriptions: [],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.kind).toBe('scalar');
    expect(r.unit).toBe('count');
    expect(r.definition).toBe('javelin_defined.churn_count');
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.period).toEqual(PERIOD_MARCH_2026);
  });
});
