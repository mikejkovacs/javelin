import { describe, it, expect } from 'vitest';
import { churnRate, subscriberChurnRateForWindow } from './churnRate';
import type {
  StripeSubscriptionLike,
  StripeSubscriptionItemLike,
} from './subscriptionEnriched';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const T_MINUS_30D = NOW_SEC - 30 * 86_400; // 2026-03-30 00:00:00 UTC

const stubItem: StripeSubscriptionItemLike = {
  id: 'si_x',
  quantity: 1,
  discounts: null,
  price: {
    id: 'price_x',
    nickname: null,
    unit_amount: 1000,
    currency: 'usd',
    product: { id: 'prod_x', name: 'X' },
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  },
};

function sub(
  id: string,
  customer: string,
  status: string,
  start_date: number,
  ended_at: number | null = null,
): StripeSubscriptionLike {
  return {
    id,
    customer,
    status,
    start_date,
    canceled_at: ended_at,
    ended_at,
    cancellation_details: null,
    pause_collection: null,
    trial_end: null,
    discounts: null,
    items: { data: [stubItem] },
  };
}

describe('churn_rate', () => {
  it('happy path: 1 churned / 5 active 30d ago + 0 new = 20%', () => {
    // cus_5's sub spanned T-30d (started before, ended 5 days after T-30d) so
    // they're counted in BOTH numerator (churned) and denominator (active 30d
    // ago) — that's the correct subscriber-churn semantic.
    const r = churnRate({
      active_subscriptions: [
        sub('a', 'cus_1', 'active', T_MINUS_30D - 86_400 * 100),
        sub('b', 'cus_2', 'active', T_MINUS_30D - 86_400 * 100),
        sub('c', 'cus_3', 'past_due', T_MINUS_30D - 86_400 * 100),
        sub('d', 'cus_4', 'active', T_MINUS_30D - 86_400 * 100),
      ],
      canceled_subscriptions: [
        sub('e', 'cus_5', 'canceled', T_MINUS_30D - 86_400 * 100, T_MINUS_30D + 86_400 * 5),
      ],
      now: NOW,
    });
    expect(r.components.churned_30d).toBe(1);
    expect(r.components.active_30d_ago).toBe(5); // 4 active + cus_5 was active at T-30d
    expect(r.components.new_30d).toBe(0);
    expect(r.value).toBe(0.2);
  });

  it('subscriber-level: 2 subs same customer counted once', () => {
    const r = churnRate({
      active_subscriptions: [
        sub('a', 'cus_1', 'active', T_MINUS_30D - 86_400 * 100),
        sub('b', 'cus_1', 'active', T_MINUS_30D - 86_400 * 100), // same customer
      ],
      canceled_subscriptions: [],
      now: NOW,
    });
    expect(r.components.active_30d_ago).toBe(1);
  });

  it('boundary: sub ended exactly at T-30d → churned counted, active_30d_ago NOT (strict > on end)', () => {
    const r = churnRate({
      active_subscriptions: [],
      canceled_subscriptions: [
        sub('a', 'cus_1', 'canceled', T_MINUS_30D - 86_400 * 100, T_MINUS_30D),
      ],
      now: NOW,
    });
    expect(r.components.churned_30d).toBe(1);
    expect(r.components.active_30d_ago).toBe(0); // ended AT T-30d, not strictly after
  });

  it('boundary: sub started exactly at T-30d → counted as active_30d_ago, NOT new', () => {
    const r = churnRate({
      active_subscriptions: [sub('a', 'cus_1', 'active', T_MINUS_30D)],
      canceled_subscriptions: [],
      now: NOW,
    });
    expect(r.components.active_30d_ago).toBe(1); // start_date <= T-30d (inclusive)
    expect(r.components.new_30d).toBe(0); // start_date NOT > T-30d
  });

  it('new_30d: sub started after T-30d', () => {
    const r = churnRate({
      active_subscriptions: [
        sub('a', 'cus_1', 'active', T_MINUS_30D + 86_400 * 5), // 5 days into window
      ],
      canceled_subscriptions: [],
      now: NOW,
    });
    expect(r.components.new_30d).toBe(1);
    expect(r.components.active_30d_ago).toBe(0);
  });

  it('canceled sub spanning T-30d: counted as active_30d_ago AND churned (numerator + denominator)', () => {
    const startedBefore = T_MINUS_30D - 86_400 * 50;
    const endedAfter = T_MINUS_30D + 86_400 * 5;
    const r = churnRate({
      active_subscriptions: [],
      canceled_subscriptions: [
        sub('a', 'cus_1', 'canceled', startedBefore, endedAfter),
      ],
      now: NOW,
    });
    // cus_1 was active at T-30d (started before, ended after) AND churned in window
    expect(r.components.active_30d_ago).toBe(1);
    expect(r.components.churned_30d).toBe(1);
    expect(r.components.new_30d).toBe(0);
    expect(r.value).toBe(1); // 1/(1+0) = 100% churn rate
  });

  it('zero denominator → value: null, components populated', () => {
    const r = churnRate({
      active_subscriptions: [],
      canceled_subscriptions: [
        sub('a', 'cus_1', 'canceled', T_MINUS_30D - 86_400 * 100, T_MINUS_30D + 86_400 * 5),
      ],
      now: NOW,
    });
    // Wait: this canceled sub started before T-30d AND ended after, so it's
    // active_30d_ago AND churned. Denominator = 1, not 0.
    // Reconstruct a true zero-denominator case:
    const r2 = churnRate({
      active_subscriptions: [],
      canceled_subscriptions: [
        sub('b', 'cus_2', 'canceled', T_MINUS_30D + 86_400, T_MINUS_30D + 86_400 * 5),
      ],
      now: NOW,
    });
    // sub started AFTER T-30d → not active_30d_ago, IS new_30d, IS churned
    expect(r2.components.churned_30d).toBe(1);
    expect(r2.components.active_30d_ago).toBe(0);
    expect(r2.components.new_30d).toBe(1);
    expect(r2.value).toBe(1); // 1/(0+1) = 1
    // Truly zero denominator:
    const r3 = churnRate({
      active_subscriptions: [],
      canceled_subscriptions: [],
      now: NOW,
    });
    expect(r3.value).toBeNull();
    expect(r3.components.churned_30d).toBe(0);
  });

  it('canceled sub with null ended_at → excluded from churned_30d', () => {
    const r = churnRate({
      active_subscriptions: [],
      canceled_subscriptions: [sub('a', 'cus_1', 'canceled', T_MINUS_30D - 86_400 * 100, null)],
      now: NOW,
    });
    expect(r.components.churned_30d).toBe(0);
  });

  it('output envelope: scalar kind, percent unit, definition + components + window', () => {
    const r = churnRate({
      active_subscriptions: [],
      canceled_subscriptions: [],
      now: NOW,
    });
    expect(r.kind).toBe('scalar');
    expect(r.unit).toBe('percent');
    expect(r.definition).toBe(
      'stripe_billing_analytics_glossary.subscriber_churn_rate',
    );
    expect(r.window.start).toBe(T_MINUS_30D);
    expect(r.window.end).toBe(NOW_SEC);
    expect(r.as_of).toBe(NOW_SEC);
  });
});

// ── Phase 2F (LTV) — subscriberChurnRateForWindow ────────────────────────────

describe('subscriberChurnRateForWindow', () => {
  const T_MINUS_90D = NOW_SEC - 90 * 86_400;
  const T_MINUS_365D = NOW_SEC - 365 * 86_400;

  it('30-day window: equivalent to canonical churnRate(); canonical definition tag', () => {
    const r = subscriberChurnRateForWindow(
      {
        active_subscriptions: [
          sub('a', 'cus_1', 'active', T_MINUS_30D - 86_400 * 100),
          sub('b', 'cus_2', 'active', T_MINUS_30D - 86_400 * 100),
          sub('c', 'cus_3', 'active', T_MINUS_30D - 86_400 * 100),
        ],
        canceled_subscriptions: [
          sub('d', 'cus_4', 'canceled', T_MINUS_30D - 86_400 * 100, NOW_SEC - 86_400 * 5),
        ],
        now: NOW,
      },
      30,
    );
    expect(r.value).toBeCloseTo(1 / 4, 6); // 1 churned / (3 active 30d ago + 1 active-then-churned 30d ago)
    expect(r.window_days).toBe(30);
    expect(r.definition).toBe(
      'stripe_billing_analytics_glossary.subscriber_churn_rate',
    );
  });

  it('90-day window: deviation definition tag; widens churn detection', () => {
    // 1 sub churned 60 days ago — invisible to 30-day, visible to 90-day.
    const r30 = subscriberChurnRateForWindow(
      {
        active_subscriptions: [
          sub('a', 'cus_1', 'active', T_MINUS_365D),
          sub('b', 'cus_2', 'active', T_MINUS_365D),
        ],
        canceled_subscriptions: [
          sub('c', 'cus_3', 'canceled', T_MINUS_365D, NOW_SEC - 86_400 * 60),
        ],
        now: NOW,
      },
      30,
    );
    expect(r30.value).toBeCloseTo(0 / 2, 6); // no churn in 30d
    expect(r30.components.churned).toBe(0);

    const r90 = subscriberChurnRateForWindow(
      {
        active_subscriptions: [
          sub('a', 'cus_1', 'active', T_MINUS_365D),
          sub('b', 'cus_2', 'active', T_MINUS_365D),
        ],
        canceled_subscriptions: [
          sub('c', 'cus_3', 'canceled', T_MINUS_365D, NOW_SEC - 86_400 * 60),
        ],
        now: NOW,
      },
      90,
    );
    expect(r90.components.churned).toBe(1);
    expect(r90.components.active_window_start).toBe(3); // all 3 spanned T-90d
    expect(r90.value).toBeCloseTo(1 / 3, 6);
    expect(r90.window_days).toBe(90);
    expect(r90.definition).toBe(
      'javelin_defined.subscriber_churn_rate_extended',
    );
  });

  it('365-day window: deviation tag; very long-window aggregation', () => {
    // 2 subs churned 200 and 300 days ago — invisible to 90-day, visible to 365-day.
    const r = subscriberChurnRateForWindow(
      {
        active_subscriptions: [
          sub('a', 'cus_1', 'active', T_MINUS_365D - 86_400 * 30),
          sub('b', 'cus_2', 'active', T_MINUS_365D - 86_400 * 30),
          sub('c', 'cus_3', 'active', T_MINUS_365D - 86_400 * 30),
        ],
        canceled_subscriptions: [
          sub('d', 'cus_4', 'canceled', T_MINUS_365D - 86_400 * 30, NOW_SEC - 86_400 * 200),
          sub('e', 'cus_5', 'canceled', T_MINUS_365D - 86_400 * 30, NOW_SEC - 86_400 * 300),
        ],
        now: NOW,
      },
      365,
    );
    expect(r.components.churned).toBe(2);
    expect(r.components.active_window_start).toBe(5);
    expect(r.value).toBeCloseTo(2 / 5, 6);
    expect(r.window_days).toBe(365);
    expect(r.definition).toBe(
      'javelin_defined.subscriber_churn_rate_extended',
    );
  });

  it('zero observed churn in any window → value null + components zero on churned', () => {
    const r = subscriberChurnRateForWindow(
      {
        active_subscriptions: [
          sub('a', 'cus_1', 'active', T_MINUS_365D),
          sub('b', 'cus_2', 'active', T_MINUS_365D),
        ],
        canceled_subscriptions: [],
        now: NOW,
      },
      90,
    );
    expect(r.components.churned).toBe(0);
    expect(r.value).toBe(0); // 0 / 2 = 0 (NOT null — denom is 2, not 0)
  });

  it('empty subscribers → denominator zero → value null', () => {
    const r = subscriberChurnRateForWindow(
      { active_subscriptions: [], canceled_subscriptions: [], now: NOW },
      90,
    );
    expect(r.value).toBeNull();
    expect(r.components.active_window_start).toBe(0);
    expect(r.components.new_in_window).toBe(0);
  });

  it('window envelope: window_days echoed; window.start matches window_days offset', () => {
    const r90 = subscriberChurnRateForWindow(
      { active_subscriptions: [], canceled_subscriptions: [], now: NOW },
      90,
    );
    expect(r90.window_days).toBe(90);
    expect(r90.window.start).toBe(T_MINUS_90D);
    expect(r90.window.end).toBe(NOW_SEC);

    const r365 = subscriberChurnRateForWindow(
      { active_subscriptions: [], canceled_subscriptions: [], now: NOW },
      365,
    );
    expect(r365.window_days).toBe(365);
    expect(r365.window.start).toBe(T_MINUS_365D);
  });

  it('refactor preserves churnRate() public API: components keyed with legacy 30d field names', () => {
    // Regression guard — churnRate() is a public wrapper over the windowed
    // helper. Field names on the result envelope must remain the legacy names
    // (churned_30d etc.) so consumers of churnRate() see no breaking change.
    const r = churnRate({
      active_subscriptions: [
        sub('a', 'cus_1', 'active', T_MINUS_30D - 86_400 * 100),
        sub('b', 'cus_2', 'active', T_MINUS_30D - 86_400 * 100),
      ],
      canceled_subscriptions: [
        sub('c', 'cus_3', 'canceled', T_MINUS_30D - 86_400 * 100, NOW_SEC - 86_400 * 5),
      ],
      now: NOW,
    });
    // Legacy field names — must not break consumers.
    expect(r.components.churned_30d).toBe(1);
    expect(r.components.active_30d_ago).toBe(3);
    expect(r.components.new_30d).toBe(0);
  });
});
