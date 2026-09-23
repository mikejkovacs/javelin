// Fixture-based tests for subscription_enriched.
// Each case builds a minimal Stripe Subscription shape and asserts the row output.

import { describe, it, expect } from 'vitest';
import {
  subscriptionEnriched,
  type StripeSubscriptionLike,
  type StripeSubscriptionItemLike,
  type StripeDiscountLike,
} from './subscriptionEnriched';

const NOW = new Date(Date.UTC(2026, 3, 16, 12, 0, 0)); // 2026-04-16T12:00:00Z
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

// ── Fixture builders ─────────────────────────────────────────────────────────

type ItemOverrides = {
  unit_amount?: number | null;
  currency?: string;
  interval?: 'day' | 'week' | 'month' | 'year';
  interval_count?: number;
  usage_type?: 'licensed' | 'metered';
  quantity?: number;
  discounts?: StripeDiscountLike[];
  product_name?: string | null;
  nickname?: string | null;
};

function makeItem(o: ItemOverrides = {}): StripeSubscriptionItemLike {
  return {
    id: 'si_test',
    quantity: o.quantity ?? 1,
    discounts: o.discounts ?? null,
    price: {
      id: 'price_test',
      nickname: o.nickname === undefined ? null : o.nickname,
      unit_amount: o.unit_amount ?? 1000, // $10 by default
      currency: o.currency ?? 'usd',
      product: { id: 'prod_test', name: o.product_name === undefined ? 'Test Product' : o.product_name },
      recurring: {
        interval: o.interval ?? 'month',
        interval_count: o.interval_count ?? 1,
        usage_type: o.usage_type ?? 'licensed',
      },
    },
  };
}

type SubOverrides = {
  id?: string;
  customer?: string;
  status?: string;
  trial_end?: number | null;
  pause_behavior?: 'keep_as_draft' | 'mark_uncollectible' | 'void' | null;
  discounts?: StripeDiscountLike[];
  items?: StripeSubscriptionItemLike[];
};

function makeSub(o: SubOverrides = {}): StripeSubscriptionLike {
  return {
    id: o.id ?? 'sub_test',
    customer: o.customer ?? 'cus_test',
    status: o.status ?? 'active',
    start_date: NOW_SEC - 86400 * 30,
    canceled_at: null,
    ended_at: null,
    cancellation_details: null,
    pause_collection: o.pause_behavior ? { behavior: o.pause_behavior } : null,
    trial_end: o.trial_end ?? null,
    discounts: o.discounts ?? null,
    items: { data: o.items ?? [makeItem()] },
  };
}

const percentOff = (pct: number): StripeDiscountLike => ({
  coupon: { percent_off: pct, amount_off: null, currency: null, duration: 'forever' },
});

const amountOff = (minor: number, currency = 'usd'): StripeDiscountLike => ({
  coupon: { percent_off: null, amount_off: minor, currency, duration: 'forever' },
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('subscription_enriched — basic intervals', () => {
  it('monthly $10 sub → monthly_normalized = 10, contributes', () => {
    const result = subscriptionEnriched({ subscriptions: [makeSub()], now: NOW });
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.raw_amount).toBe(10);
    expect(row.monthly_normalized_amount).toBe(10);
    expect(row.contributes_to_mrr).toBe(true);
    expect(row.currency).toBe('usd');
    expect(row.interval).toBe('month');
  });

  it('annual $120 sub → monthly_normalized = 10', () => {
    const sub = makeSub({ items: [makeItem({ unit_amount: 12000, interval: 'year' })] });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.raw_amount).toBe(120);
    expect(row.monthly_normalized_amount).toBeCloseTo(10, 6);
    expect(row.interval).toBe('year');
  });

  it('weekly $5 sub → monthly_normalized = 5 × (52/12)', () => {
    const sub = makeSub({ items: [makeItem({ unit_amount: 500, interval: 'week' })] });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.monthly_normalized_amount).toBeCloseTo(5 * (52 / 12), 6);
  });

  it('daily $1 sub → monthly_normalized = 1 × (365/12)', () => {
    const sub = makeSub({ items: [makeItem({ unit_amount: 100, interval: 'day' })] });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.monthly_normalized_amount).toBeCloseTo(365 / 12, 6);
  });

  it('quarterly = month × 3 → monthly_normalized = raw / 3', () => {
    const sub = makeSub({
      items: [makeItem({ unit_amount: 30000, interval: 'month', interval_count: 3 })],
    });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.raw_amount).toBe(300);
    expect(row.monthly_normalized_amount).toBeCloseTo(100, 6);
  });
});

describe('subscription_enriched — exclusions', () => {
  it('trialing sub → contributes_to_mrr = false, monthly_normalized = 0', () => {
    const sub = makeSub({ status: 'trialing', trial_end: NOW_SEC + 86400 * 7 });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.contributes_to_mrr).toBe(false);
    expect(row.monthly_normalized_amount).toBe(0);
    expect(row.raw_amount).toBe(10); // raw still computed for transparency
  });

  it('active sub with future trial_end → still excluded (trial overrides status)', () => {
    const sub = makeSub({ trial_end: NOW_SEC + 86400 });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.contributes_to_mrr).toBe(false);
  });

  it('active sub with past trial_end → contributes', () => {
    const sub = makeSub({ trial_end: NOW_SEC - 86400 });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.contributes_to_mrr).toBe(true);
  });

  it('past_due sub → contributes (matches def doc inclusion)', () => {
    const sub = makeSub({ status: 'past_due' });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.contributes_to_mrr).toBe(true);
  });

  it('canceled sub → does not contribute', () => {
    const sub = makeSub({ status: 'canceled' });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.contributes_to_mrr).toBe(false);
    expect(row.monthly_normalized_amount).toBe(0);
  });

  it('paused (void) → does not contribute', () => {
    const sub = makeSub({ pause_behavior: 'void' });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.contributes_to_mrr).toBe(false);
    expect(row.pause_collection_behavior).toBe('void');
  });

  it('paused (mark_uncollectible) → does not contribute', () => {
    const sub = makeSub({ pause_behavior: 'mark_uncollectible' });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.contributes_to_mrr).toBe(false);
  });

  it('paused (keep_as_draft) → contributes (def doc keeps these)', () => {
    const sub = makeSub({ pause_behavior: 'keep_as_draft' });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.contributes_to_mrr).toBe(true);
    expect(row.pause_collection_behavior).toBe('keep_as_draft');
  });

  it('free item only (unit_amount = 0) → raw_amount = 0, no contribution', () => {
    const sub = makeSub({ items: [makeItem({ unit_amount: 0 })] });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.raw_amount).toBe(0);
    expect(row.contributes_to_mrr).toBe(false);
  });

  it('metered item only → raw_amount = 0, no contribution', () => {
    const sub = makeSub({ items: [makeItem({ usage_type: 'metered' })] });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.raw_amount).toBe(0);
    expect(row.contributes_to_mrr).toBe(false);
  });

  it('mixed paid + metered items → only paid contributes', () => {
    const sub = makeSub({
      items: [
        makeItem({ unit_amount: 2000 }), // $20 licensed
        makeItem({ unit_amount: 100, usage_type: 'metered' }), // ignored
      ],
    });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.raw_amount).toBe(20);
    expect(row.contributes_to_mrr).toBe(true);
  });
});

describe('subscription_enriched — discounts', () => {
  it('subscription-level percent_off 50% halves raw_amount', () => {
    const sub = makeSub({ discounts: [percentOff(50)] });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.raw_amount).toBe(5);
    expect(row.monthly_normalized_amount).toBe(5);
  });

  it('item-level percent_off 25% applies before sub-level', () => {
    const sub = makeSub({
      items: [makeItem({ unit_amount: 1000, discounts: [percentOff(25)] })], // $10 → $7.50
      discounts: [percentOff(50)], // $7.50 → $3.75
    });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.raw_amount).toBeCloseTo(3.75, 6);
  });

  it('subscription-level amount_off subtracts from raw_amount', () => {
    const sub = makeSub({ discounts: [amountOff(300)] }); // $3 off
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.raw_amount).toBe(7);
  });

  it('discount that zeros raw_amount → no MRR contribution', () => {
    const sub = makeSub({ discounts: [percentOff(100)] });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.raw_amount).toBe(0);
    expect(row.contributes_to_mrr).toBe(false);
  });
});

describe('subscription_enriched — currency handling', () => {
  it('JPY (zero-decimal) → divisor = 1, raw_amount = unit_amount as-is', () => {
    const sub = makeSub({ items: [makeItem({ unit_amount: 1500, currency: 'jpy' })] });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.currency).toBe('jpy');
    expect(row.raw_amount).toBe(1500);
    expect(row.monthly_normalized_amount).toBe(1500);
  });

  it('BHD (three-decimal) → divisor = 1000', () => {
    const sub = makeSub({ items: [makeItem({ unit_amount: 5000, currency: 'bhd' })] });
    const row = subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0];
    expect(row.raw_amount).toBe(5);
  });

  it('multi-sub multi-currency → distinct rows preserve currency', () => {
    const usdSub = makeSub({ id: 'sub_usd', items: [makeItem({ unit_amount: 1000, currency: 'usd' })] });
    const eurSub = makeSub({ id: 'sub_eur', items: [makeItem({ unit_amount: 2000, currency: 'eur' })] });
    const result = subscriptionEnriched({ subscriptions: [usdSub, eurSub], now: NOW });
    expect(result.rows.map((r) => r.currency)).toEqual(['usd', 'eur']);
    expect(result.rows.map((r) => r.raw_amount)).toEqual([10, 20]);
  });
});

describe('subscription_enriched — plan_name fallback', () => {
  it('uses nickname when present', () => {
    const sub = makeSub({ items: [makeItem({ nickname: 'Pro Monthly', product_name: 'Pro Plan' })] });
    expect(subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0].plan_name).toBe('Pro Monthly');
  });

  it('falls back to product.name when nickname is null', () => {
    const sub = makeSub({ items: [makeItem({ nickname: null, product_name: 'Pro Plan' })] });
    expect(subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0].plan_name).toBe('Pro Plan');
  });

  it('empty string when both null', () => {
    const sub = makeSub({ items: [makeItem({ nickname: null, product_name: null })] });
    expect(subscriptionEnriched({ subscriptions: [sub], now: NOW }).rows[0].plan_name).toBe('');
  });
});

describe('subscription_enriched — output envelope', () => {
  it('kind = rows, definition + as_of populated', () => {
    const result = subscriptionEnriched({ subscriptions: [makeSub()], now: NOW });
    expect(result.kind).toBe('rows');
    expect(result.definition).toBe('javelin.subscription_enriched.v1');
    expect(result.as_of).toBe(NOW_SEC);
  });

  it('empty input → empty rows', () => {
    const result = subscriptionEnriched({ subscriptions: [], now: NOW });
    expect(result.rows).toEqual([]);
    expect(result.kind).toBe('rows');
  });
});
