import { describe, it, expect } from 'vitest';
import { ltv } from './ltv';
import type {
  StripeSubscriptionLike,
  StripeSubscriptionItemLike,
} from './subscriptionEnriched';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const T_MINUS_30D = NOW_SEC - 30 * 86_400;
const T_MINUS_365D = NOW_SEC - 365 * 86_400;
const T_MINUS_500D = NOW_SEC - 500 * 86_400;

function item(unit_amount: number, currency: string = 'usd'): StripeSubscriptionItemLike {
  return {
    id: 'si_x',
    quantity: 1,
    discounts: null,
    price: {
      id: 'price_x',
      nickname: null,
      unit_amount,
      currency,
      product: { id: 'prod_x', name: 'X' },
      recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    },
  };
}

function sub(
  id: string,
  customer: string,
  status: string,
  start_date: number,
  unit_amount: number = 2500,
  currency: string = 'usd',
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
    items: { data: [item(unit_amount, currency)] },
  };
}

describe('ltv', () => {
  // ── Envelope basics ─────────────────────────────────────────────────────

  it('empty input: returns one row with no_subscribers coverage; envelope flags set', () => {
    const r = ltv({
      subscriptions: [],
      active_subscriptions: [],
      canceled_subscriptions: [],
      now: NOW,
    });
    expect(r.kind).toBe('rows');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].coverage).toBe('no_subscribers');
    expect(r.rows[0].value).toBeNull();
    expect(r.scope).toBe('subscription_mrr');
    expect(r.window_used).toBe('30d');
    expect(r.deviates_from_stripe_canonical).toBe(false);
    expect(r.definition).toBe('javelin_defined.ltv');
    expect(r.as_of).toBe(NOW_SEC);
  });

  it('default window is 30d when churn_window unspecified', () => {
    const r = ltv({
      subscriptions: [sub('a', 'cus_1', 'active', T_MINUS_365D)],
      active_subscriptions: [sub('a', 'cus_1', 'active', T_MINUS_365D)],
      canceled_subscriptions: [],
      now: NOW,
    });
    expect(r.window_used).toBe('30d');
    expect(r.deviates_from_stripe_canonical).toBe(false);
  });

  it('window_used echoed; deviates flag flips for 90d and 365d', () => {
    const r90 = ltv({
      subscriptions: [sub('a', 'cus_1', 'active', T_MINUS_365D)],
      active_subscriptions: [sub('a', 'cus_1', 'active', T_MINUS_365D)],
      canceled_subscriptions: [],
      churn_window: '90d',
      now: NOW,
    });
    expect(r90.window_used).toBe('90d');
    expect(r90.deviates_from_stripe_canonical).toBe(true);

    const r365 = ltv({
      subscriptions: [sub('a', 'cus_1', 'active', T_MINUS_500D)],
      active_subscriptions: [sub('a', 'cus_1', 'active', T_MINUS_500D)],
      canceled_subscriptions: [],
      churn_window: '365d',
      now: NOW,
    });
    expect(r365.window_used).toBe('365d');
    expect(r365.deviates_from_stripe_canonical).toBe(true);
  });

  // ── Coverage states ─────────────────────────────────────────────────────

  it('no_subscribers coverage when subscription list is empty', () => {
    const r = ltv({
      subscriptions: [],
      active_subscriptions: [],
      canceled_subscriptions: [],
      now: NOW,
    });
    expect(r.rows[0].coverage).toBe('no_subscribers');
    expect(r.rows[0].arpu).toBe(0);
    expect(r.rows[0].implied_lifetime_months).toBeNull();
  });

  it('no_churn_observed coverage when subscribers exist but churn rate is 0', () => {
    // 5 active subs, none churned in 30d → churn_rate = 0/5 = 0 → null LTV
    const subs = [
      sub('a', 'cus_1', 'active', T_MINUS_365D),
      sub('b', 'cus_2', 'active', T_MINUS_365D),
      sub('c', 'cus_3', 'active', T_MINUS_365D),
      sub('d', 'cus_4', 'active', T_MINUS_365D),
      sub('e', 'cus_5', 'active', T_MINUS_365D),
    ];
    const r = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: [],
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].coverage).toBe('no_churn_observed');
    expect(r.rows[0].value).toBeNull();
    expect(r.rows[0].arpu).toBe(25);                // 5 subs at $25 / 5 subs = $25 ARPU
    expect(r.rows[0].churn_rate).toBe(0);
    expect(r.rows[0].implied_lifetime_months).toBeNull();
    expect(r.rows[0].low_sample).toBe(true);        // 5 < 10
  });

  it('computed coverage when both ARPU and churn rate are valid', () => {
    // 4 active subs at $25 each + 1 churned 5d ago.
    // ARPU = $100 MRR / 4 active subs = $25 (recurring basis uses active subs only).
    // Churn rate = 1 churned / (4 active 30d ago + 1 churned-but-active 30d ago + 0 new) = 1/5 = 20%.
    // (cus_5 is counted in BOTH numerator and denominator per the subscriber-churn semantic.)
    // LTV = 25 / 0.20 = $125, implied lifetime = 5 months.
    const subs = [
      sub('a', 'cus_1', 'active', T_MINUS_365D),
      sub('b', 'cus_2', 'active', T_MINUS_365D),
      sub('c', 'cus_3', 'active', T_MINUS_365D),
      sub('d', 'cus_4', 'active', T_MINUS_365D),
    ];
    const churned = [
      sub('e', 'cus_5', 'canceled', T_MINUS_365D, 2500, 'usd', NOW_SEC - 86_400 * 5),
    ];
    const r = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: churned,
      now: NOW,
    });
    expect(r.rows[0].coverage).toBe('computed');
    expect(r.rows[0].value).toBeCloseTo(125, 4);
    expect(r.rows[0].arpu).toBeCloseTo(25, 4);
    expect(r.rows[0].churn_rate).toBeCloseTo(0.2, 4);
    expect(r.rows[0].implied_lifetime_months).toBeCloseTo(5, 4);
  });

  // ── Windowed-churn behavior ─────────────────────────────────────────────

  it('30d window null becomes 90d window number for same data', () => {
    // 1 churned 60 days ago — invisible to 30-day, visible to 90-day.
    const subs = [
      sub('a', 'cus_1', 'active', T_MINUS_365D),
      sub('b', 'cus_2', 'active', T_MINUS_365D),
    ];
    const churned = [
      sub('c', 'cus_3', 'canceled', T_MINUS_365D, 2500, 'usd', NOW_SEC - 86_400 * 60),
    ];
    const r30 = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: churned,
      now: NOW,
    });
    expect(r30.rows[0].coverage).toBe('no_churn_observed');
    expect(r30.rows[0].value).toBeNull();

    const r90 = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: churned,
      churn_window: '90d',
      now: NOW,
    });
    expect(r90.rows[0].coverage).toBe('computed');
    // 2 active subs at $25 → ARPU=$25; churn 1/3 = 33.3%; LTV = 25/0.333 = $75
    expect(r90.rows[0].value).toBeCloseTo(75, 1);
    expect(r90.rows[0].churn_rate).toBeCloseTo(1 / 3, 4);
  });

  it('365d window finds churn that even 90d missed', () => {
    // 1 churned 200 days ago — invisible to 90-day, visible to 365-day.
    const subs = [
      sub('a', 'cus_1', 'active', T_MINUS_500D),
      sub('b', 'cus_2', 'active', T_MINUS_500D),
    ];
    const churned = [
      sub('c', 'cus_3', 'canceled', T_MINUS_500D, 2500, 'usd', NOW_SEC - 86_400 * 200),
    ];
    const r90 = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: churned,
      churn_window: '90d',
      now: NOW,
    });
    expect(r90.rows[0].coverage).toBe('no_churn_observed');

    const r365 = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: churned,
      churn_window: '365d',
      now: NOW,
    });
    expect(r365.rows[0].coverage).toBe('computed');
    expect(r365.rows[0].value).toBeCloseTo(75, 1);
  });

  // ── Multi-currency ──────────────────────────────────────────────────────

  it('multi-currency: per-currency rows; single global churn rate applies to both', () => {
    // 3 USD subs at $25, 2 CAD subs at CA$50 → ARPU_usd=$25, ARPU_cad=CA$50
    // Global subs: 5 active + 1 churned 5d ago (USD)
    // Churn rate = 1 churned / 5 active 30d ago = 20%
    // LTV_usd = 25/0.20 = $125; LTV_cad = 50/0.20 = CA$250
    const subs = [
      sub('a', 'cus_1', 'active', T_MINUS_365D, 2500, 'usd'),
      sub('b', 'cus_2', 'active', T_MINUS_365D, 2500, 'usd'),
      sub('c', 'cus_3', 'active', T_MINUS_365D, 2500, 'usd'),
      sub('d', 'cus_4', 'active', T_MINUS_365D, 5000, 'cad'),
      sub('e', 'cus_5', 'active', T_MINUS_365D, 5000, 'cad'),
    ];
    const churned = [
      sub('f', 'cus_6', 'canceled', T_MINUS_365D, 2500, 'usd', NOW_SEC - 86_400 * 5),
    ];
    const r = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: churned,
      now: NOW,
    });
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
    const usd = r.rows.find((x) => x.currency === 'usd');
    const cad = r.rows.find((x) => x.currency === 'cad');
    expect(usd).toBeDefined();
    expect(cad).toBeDefined();
    // Both rows share the same churn rate (global)
    expect(usd!.churn_rate).toBe(cad!.churn_rate);
    expect(usd!.churn_rate).toBeCloseTo(1 / 6, 4); // 1 churned / (5 active 30d ago + 1 churned-from-active)
    expect(usd!.value).toBeGreaterThan(0);
    expect(cad!.value).toBeGreaterThan(0);
    // CAD LTV in CA dollars (no FX); USD LTV in dollars
    expect(cad!.value!).toBeGreaterThan(usd!.value!); // cad has higher ARPU
  });

  // ── Low-sample forwarding ────────────────────────────────────────────────

  it('low_sample flag forwarded from ARPU when subscriber count < 10', () => {
    const subs = [
      sub('a', 'cus_1', 'active', T_MINUS_365D),
      sub('b', 'cus_2', 'active', T_MINUS_365D),
      sub('c', 'cus_3', 'active', T_MINUS_365D),
    ];
    const churned = [
      sub('d', 'cus_4', 'canceled', T_MINUS_365D, 2500, 'usd', NOW_SEC - 86_400 * 5),
    ];
    const r = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: churned,
      now: NOW,
    });
    expect(r.rows[0].low_sample).toBe(true);
    expect(r.rows[0].coverage).toBe('computed');     // computed even with low sample
  });

  it('low_sample false when active subscriber count >= 10', () => {
    const subs: StripeSubscriptionLike[] = [];
    for (let i = 0; i < 12; i++) {
      subs.push(sub(`s${i}`, `cus_${i}`, 'active', T_MINUS_365D));
    }
    const churned = [
      sub('cx', 'cus_x', 'canceled', T_MINUS_365D, 2500, 'usd', NOW_SEC - 86_400 * 5),
    ];
    const r = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: churned,
      now: NOW,
    });
    expect(r.rows[0].low_sample).toBe(false);
  });

  // ── Implied-lifetime ────────────────────────────────────────────────────

  it('implied_lifetime_months: 1/churn_rate when computed; null otherwise', () => {
    // 10 subs, 1 churned in 30d → churn = 1/10 = 10% → lifetime = 10 months
    const subs: StripeSubscriptionLike[] = [];
    for (let i = 0; i < 10; i++) {
      subs.push(sub(`s${i}`, `cus_${i}`, 'active', T_MINUS_365D));
    }
    const churned = [
      sub('cx', 'cus_x', 'canceled', T_MINUS_365D, 2500, 'usd', NOW_SEC - 86_400 * 5),
    ];
    const r = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: churned,
      now: NOW,
    });
    expect(r.rows[0].implied_lifetime_months).toBeCloseTo(11, 1); // 1 / (1/11) = 11 (10 active + 1 churned-from-active)
  });

  // ── Reconciliation with Stripe's example ────────────────────────────────

  it('Stripe published example: ARPU $500, churn 9%, LTV ~$5,556', () => {
    // From Stripe Billing analytics glossary documentation:
    //   ARPU = $500, churn rate = 9% → LTV = $5,555.55
    // Hard to hit 9% exactly with discrete subscribers, so synthesize:
    // 91 active subs + 9 churned in 30d → churn = 9/100 = 9%; ARPU = $500 needs $500/sub
    const subs: StripeSubscriptionLike[] = [];
    for (let i = 0; i < 91; i++) {
      subs.push(sub(`s${i}`, `cus_${i}`, 'active', T_MINUS_365D, 50000));  // $500/mo
    }
    const churned: StripeSubscriptionLike[] = [];
    for (let i = 0; i < 9; i++) {
      churned.push(
        sub(`c${i}`, `cusc_${i}`, 'canceled', T_MINUS_365D, 50000, 'usd', NOW_SEC - 86_400 * 5),
      );
    }
    const r = ltv({
      subscriptions: subs,
      active_subscriptions: subs,
      canceled_subscriptions: churned,
      now: NOW,
    });
    expect(r.rows[0].coverage).toBe('computed');
    expect(r.rows[0].arpu).toBeCloseTo(500, 1);
    expect(r.rows[0].churn_rate).toBeCloseTo(0.09, 2);
    expect(r.rows[0].value).toBeCloseTo(5555.55, 0);
  });

  // ── Definition tag ───────────────────────────────────────────────────────

  it('definition tag: javelin_defined.ltv', () => {
    const r = ltv({
      subscriptions: [],
      active_subscriptions: [],
      canceled_subscriptions: [],
      now: NOW,
    });
    expect(r.definition).toBe('javelin_defined.ltv');
  });
});
