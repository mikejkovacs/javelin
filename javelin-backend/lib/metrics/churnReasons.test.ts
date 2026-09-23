import { describe, it, expect } from 'vitest';
import { churnReasons } from './churnReasons';
import type {
  StripeSubscriptionLike,
  StripeSubscriptionItemLike,
} from './subscriptionEnriched';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const PERIOD_MARCH_2026 = {
  start: Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};

function canceledSub(
  id: string,
  ended_at: number | null,
  feedback: string | null,
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
    status: 'canceled',
    start_date: NOW_SEC - 86400 * 365,
    canceled_at: ended_at,
    ended_at,
    cancellation_details: { reason: 'cancellation_requested', feedback },
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

describe('churn_reasons', () => {
  it('all feedback null → coverage: none, all in `none` bucket', () => {
    const r = churnReasons({
      subscriptions: [
        canceledSub('a', MAR_05, null),
        canceledSub('b', MAR_15, null),
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.total).toBe(2);
    expect(r.value.feedback_provided).toBe(0);
    expect(r.value.buckets.none).toBe(2);
    expect(r.coverage).toBe('none');
  });

  it('all feedback provided → coverage: high', () => {
    const r = churnReasons({
      subscriptions: [
        canceledSub('a', MAR_05, 'too_expensive'),
        canceledSub('b', MAR_15, 'missing_features'),
        canceledSub('c', MAR_25, 'switched_service'),
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.total).toBe(3);
    expect(r.value.feedback_provided).toBe(3);
    expect(r.value.buckets.too_expensive).toBe(1);
    expect(r.value.buckets.missing_features).toBe(1);
    expect(r.value.buckets.switched_service).toBe(1);
    expect(r.value.buckets.none).toBe(0);
    expect(r.coverage).toBe('high');
  });

  it('half coverage → coverage: high (50% threshold inclusive)', () => {
    const r = churnReasons({
      subscriptions: [
        canceledSub('a', MAR_05, 'too_expensive'),
        canceledSub('b', MAR_15, null),
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.coverage).toBe('high');
  });

  it('one-third coverage → coverage: partial', () => {
    const r = churnReasons({
      subscriptions: [
        canceledSub('a', MAR_05, 'too_expensive'),
        canceledSub('b', MAR_15, null),
        canceledSub('c', MAR_25, null),
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.feedback_provided).toBe(1);
    expect(r.coverage).toBe('partial');
  });

  it('date filter: ended_at outside period → excluded', () => {
    const r = churnReasons({
      subscriptions: [
        canceledSub('a', MAR_15, 'too_expensive'),
        canceledSub('b', FEB_15, 'too_expensive'),
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.total).toBe(1);
    expect(r.value.buckets.too_expensive).toBe(1);
  });

  it('defensive: unrecognized future feedback enum → other', () => {
    const r = churnReasons({
      subscriptions: [
        canceledSub('a', MAR_05, 'switched_to_competitor_x'), // hypothetical
      ],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.buckets.other).toBe(1);
    expect(r.value.feedback_provided).toBe(1);
  });

  it('empty input → all zeros, coverage: none', () => {
    const r = churnReasons({
      subscriptions: [],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.value.total).toBe(0);
    expect(r.coverage).toBe('none');
  });

  it('output envelope: scalar kind, count unit, definition + as_of + period', () => {
    const r = churnReasons({
      subscriptions: [],
      period: PERIOD_MARCH_2026,
      now: NOW,
    });
    expect(r.kind).toBe('scalar');
    expect(r.unit).toBe('count');
    expect(r.definition).toBe('javelin_defined.churn_reasons');
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.period).toEqual(PERIOD_MARCH_2026);
  });
});
