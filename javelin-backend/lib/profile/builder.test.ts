import { describe, it, expect } from 'vitest';
import { buildProfile, type BuildProfileDeps } from './builder';
import { PROFILE_SCHEMA_VERSION, isLayer2Stale, type Profile } from './types';
import type { StripeSubscriptionLike, StripeSubscriptionItemLike } from '../metrics/subscriptionEnriched';
import type { StripeChargeLike } from '../metrics/chargeEnriched';
import type { StripeInvoiceLike } from '../metrics/invoiceEnriched';

const NOW = new Date(Date.UTC(2026, 3, 23, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

function sub(
  id: string,
  unit_amount: number,
  nickname = 'Basic',
  currency = 'usd',
  status = 'active'
): StripeSubscriptionLike {
  const item: StripeSubscriptionItemLike = {
    id: `si_${id}`,
    quantity: 1,
    discounts: null,
    price: {
      id: `price_${id}`,
      nickname,
      unit_amount,
      currency,
      product: { id: `prod_${id}`, name: `Plan ${id}` },
      recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    },
  };
  return {
    id,
    customer: `cus_${id}`,
    status,
    start_date: NOW_SEC - 86400 * 90,
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
  amount: number,
  currency = 'usd',
  extras: Partial<StripeChargeLike> & { payment_method_details?: { type?: string } } = {}
): StripeChargeLike {
  const {
    status = 'succeeded',
    created = NOW_SEC - 86400 * 30,
    payment_method_details,
    ...rest
  } = extras;
  return {
    id,
    customer: `cus_${id}`,
    amount,
    amount_refunded: 0,
    currency,
    status,
    created,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    payment_method_details: payment_method_details
      ? {
          ...(payment_method_details as { type?: string; card?: { brand?: string | null; country?: string | null } }),
          card: (payment_method_details as { card?: { country?: string | null } }).card ?? {
            country: 'US',
            brand: 'visa',
          },
        }
      : { card: { country: 'US', brand: 'visa' } },
    billing_details: null,
    ...rest,
  } as StripeChargeLike;
}

function invoice(id: string, subtotal: number, total: number, currency = 'usd'): StripeInvoiceLike {
  const ts = NOW_SEC - 86400 * 60;
  return {
    id,
    customer: `cus_${id}`,
    status: 'paid',
    subtotal,
    total,
    total_excluding_tax: subtotal,
    amount_paid: total,
    amount_due: 0,
    amount_remaining: 0,
    currency,
    created: ts,
    status_transitions: {
      finalized_at: ts,
      paid_at: ts,
      voided_at: null,
      marked_uncollectible_at: null,
    },
    tax: total - subtotal,
    lines: { data: [] },
  } as StripeInvoiceLike;
}

function makeDeps(overrides: Partial<BuildProfileDeps> = {}): BuildProfileDeps {
  return {
    getActiveSubscriptions: async () => [],
    getCustomers: async () => [],
    getCharges: async () => [],
    getBilledInvoices: async () => [],
    getConnectedAccounts: async () => [],
    getOldestCharge: async () => null,
    getCanceledSubscriptions: async () => [],
    ...overrides,
  };
}

describe('buildProfile', () => {
  it('empty account → minimal profile (only version/builtAt/mode, all fields absent)', async () => {
    const p = await buildProfile({ mode: 'live', now: NOW, deps: makeDeps() });
    expect(p.version).toBe(PROFILE_SCHEMA_VERSION);
    expect(p.mode).toBe('live');
    expect(p.layer1!.builtAt).toBe(NOW.toISOString());
    // P1-S8 Option A: empty fields are OMITTED, not sentinel-filled
    expect(p.layer1!.business_shape).toBeUndefined();
    expect(p.layer1!.catalog).toBeUndefined();
    expect(p.layer1!.scale).toBeUndefined();
    expect(p.layer1!.geography_mix).toBeUndefined();
    expect(p.layer1!.payment_method_mix).toBeUndefined();
    expect(p.layer1!.currency_mix).toBeUndefined();
    expect(p.layer1!.first_charge_date).toBeUndefined();
    // v3: account_age_days dropped — Profile no longer has the field at all
    expect((p as unknown as Record<string, unknown>).account_age_days).toBeUndefined();
  });

  it('subscription-only account → business_shape includes subscription, excludes one_time/connect', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getActiveSubscriptions: async () => [sub('s1', 2500)], // $25/mo active
      }),
    });
    expect(p.layer1!.business_shape).toEqual(['subscription']);
  });

  it('charge-only account → business_shape includes one_time, excludes subscription', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getCharges: async () => [charge('c1', 5000)],
      }),
    });
    expect(p.layer1!.business_shape).toEqual(['one_time']);
  });

  it('subs + charges + connected accounts → hybrid shape', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getActiveSubscriptions: async () => [sub('s1', 1000)],
        getCharges: async () => [charge('c1', 2000)],
        getConnectedAccounts: async () => [{ id: 'acct_x' }],
      }),
    });
    expect(p.layer1!.business_shape).toEqual(['subscription', 'one_time', 'connect']);
  });

  it('catalog falls back to product.name when price has no nickname', async () => {
    // Merchant A-style: prices have no nickname, but products are named.
    // The builder should join product names by product_id.
    const subWithoutNickname = sub('a', 2500, ''); // empty nickname
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getActiveSubscriptions: async () => [subWithoutNickname],
        getProducts: async () => [
          { id: 'prod_a', name: 'Merchant A Pro' },
        ],
      }),
    });
    expect(p.layer1!.catalog).toHaveLength(1);
    expect(p.layer1!.catalog![0].name).toBe('Merchant A Pro');
  });

  it('catalog plan_name falls through to "" when neither nickname nor product name available', async () => {
    // Defensive: if the merchant has truly nameless products AND no nicknames,
    // we still emit an entry (so the count is right) — name is just empty.
    const subWithoutNickname = sub('a', 2500, '');
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getActiveSubscriptions: async () => [subWithoutNickname],
        getProducts: async () => [], // no products fetched
      }),
    });
    expect(p.layer1!.catalog).toHaveLength(1);
    expect(p.layer1!.catalog![0].name).toBe('');
    expect(p.layer1!.catalog![0].active_count).toBe(1);
  });

  it('catalog is aggregated by plan name + currency; counts active subs', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getActiveSubscriptions: async () => [
          sub('a', 2500, 'Basic'),
          sub('b', 2500, 'Basic'),
          sub('c', 5000, 'Pro'),
        ],
      }),
    });
    expect(p.layer1!.catalog).toHaveLength(2);
    // sorted by monthly_amount desc (Pro $50 is 1 active > Basic $25 × 2 = $50 total → tie; ordering is stable)
    const basic = p.layer1!.catalog!.find((c) => c.name === 'Basic')!;
    expect(basic.active_count).toBe(2);
    expect(basic.monthly_amount).toBeCloseTo(50); // 2500 + 2500 in major units
    const pro = p.layer1!.catalog!.find((c) => c.name === 'Pro')!;
    expect(pro.active_count).toBe(1);
    expect(pro.monthly_amount).toBeCloseTo(50);
  });

  it('scale.customer_count reflects customers list length', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getCustomers: async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      }),
    });
    expect(p.layer1!.scale?.customer_count).toBe(3);
  });

  it('scale.mrr picks the highest-MRR currency for multi-currency', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getActiveSubscriptions: async () => [
          sub('a', 10000, 'USD', 'usd'),  // $100/mo
          sub('b', 50000, 'CAD', 'cad'),  // CA$500/mo
        ],
      }),
    });
    expect(p.layer1!.scale?.mrr_currency).toBe('cad');
    expect(p.layer1!.scale?.mrr_amount).toBeCloseTo(500);
  });

  it('scale.annual_revenue comes from trailing 12m billed invoices', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getBilledInvoices: async () => [invoice('i1', 10000, 11000), invoice('i2', 5000, 5500)],
      }),
    });
    expect(p.layer1!.scale?.annual_revenue_currency).toBe('usd');
    expect(p.layer1!.scale?.annual_revenue_amount).toBeCloseTo(150); // 15000 cents major = $150 subtotal basis
  });

  it('geography_mix weighted by net_collected, top 5', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getCharges: async () => [
          charge('c1', 8000, 'usd', { payment_method_details: { type: 'card', card: { country: 'US', brand: 'visa' } } }),
          charge('c2', 2000, 'usd', { payment_method_details: { type: 'card', card: { country: 'CA', brand: 'visa' } } }),
        ],
      }),
    });
    expect(p.layer1!.geography_mix).toHaveLength(2);
    expect(p.layer1!.geography_mix![0]).toEqual({ key: 'US', share: 0.8 });
    expect(p.layer1!.geography_mix![1]).toEqual({ key: 'CA', share: 0.2 });
  });

  it('payment_method_mix weighted by amount', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getCharges: async () => [
          charge('c1', 7500, 'usd', { payment_method_details: { type: 'card', card: { country: 'US' } } }),
          charge('c2', 2500, 'usd', { payment_method_details: { type: 'link', card: { country: 'US' } } }),
        ],
      }),
    });
    expect(p.layer1!.payment_method_mix).toEqual([
      { key: 'card', share: 0.75 },
      { key: 'link', share: 0.25 },
    ]);
  });

  it('currency_mix is per-currency amount weights', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getCharges: async () => [
          charge('c1', 10000, 'usd'),
          charge('c2', 10000, 'cad'),
          charge('c3', 20000, 'usd'),
        ],
      }),
    });
    expect(p.layer1!.currency_mix).toHaveLength(2);
    expect(p.layer1!.currency_mix!.find((r) => r.key === 'usd')?.share).toBeCloseTo(0.75);
    expect(p.layer1!.currency_mix!.find((r) => r.key === 'cad')?.share).toBeCloseTo(0.25);
  });

  it('first_charge_date from getOldestCharge', async () => {
    const jan1_2025 = Date.UTC(2025, 0, 1) / 1000;
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getOldestCharge: async () => ({ created: jan1_2025 }),
      }),
    });
    expect(p.layer1!.first_charge_date).toBe('2025-01-01');
  });

  it('mode flows through to the stored profile (P1-S7)', async () => {
    const live = await buildProfile({ mode: 'live', now: NOW, deps: makeDeps() });
    const test = await buildProfile({ mode: 'test', now: NOW, deps: makeDeps() });
    expect(live.mode).toBe('live');
    expect(test.mode).toBe('test');
  });

  it('failed charges do NOT contribute to mixes or one_time shape', async () => {
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getCharges: async () => [charge('c1', 10000, 'usd', { status: 'failed' })],
      }),
    });
    expect(p.layer1!.business_shape).toBeUndefined();
    expect(p.layer1!.geography_mix).toBeUndefined();
    expect(p.layer1!.payment_method_mix).toBeUndefined();
    expect(p.layer1!.currency_mix).toBeUndefined();
  });
});

// ── Layer 2 ─────────────────────────────────────────────────────────────────

const SEC_PER_MONTH = 30 * 86400;

function recurringInvoice(
  id: string,
  subtotal: number,
  status: 'paid' | 'open' | 'uncollectible',
  monthsAgo: number,
  hasRecurring = true,
): StripeInvoiceLike {
  const ts = NOW_SEC - monthsAgo * SEC_PER_MONTH;
  return {
    id,
    customer: `cus_${id}`,
    status,
    subtotal,
    total: subtotal,
    total_excluding_tax: subtotal,
    amount_paid: status === 'paid' ? subtotal : 0,
    amount_due: status === 'paid' ? 0 : subtotal,
    amount_remaining: status === 'paid' ? 0 : subtotal,
    currency: 'usd',
    created: ts,
    status_transitions: {
      finalized_at: ts,
      paid_at: status === 'paid' ? ts : null,
      voided_at: null,
      marked_uncollectible_at: status === 'uncollectible' ? ts : null,
    },
    tax: 0,
    lines: {
      data: [
        {
          amount: subtotal,
          price: {
            id: 'price_1',
            product: 'prod_1',
            ...(hasRecurring
              ? { recurring: { interval: 'month' as const, interval_count: 1 } }
              : {}),
          },
        },
      ],
    },
  } as StripeInvoiceLike;
}

function customerAt(id: string, monthsAgo: number) {
  return { id, created: NOW_SEC - monthsAgo * SEC_PER_MONTH };
}

function cancelSub(createdMonthsAgo: number, canceledMonthsAgo: number) {
  return {
    created: NOW_SEC - createdMonthsAgo * SEC_PER_MONTH,
    canceled_at: NOW_SEC - canceledMonthsAgo * SEC_PER_MONTH,
  };
}

describe('buildProfile — Layer 2', () => {
  it('populated fixtures → emits all 8 L2 fields', async () => {
    // 12 monthly recurring paid invoices + 6 uncollectibles spread over 6m.
    const billed: StripeInvoiceLike[] = [];
    for (let m = 0; m < 12; m++) billed.push(recurringInvoice(`p${m}`, 50000, 'paid', m));
    for (let m = 0; m < 6; m++) billed.push(recurringInvoice(`u${m}`, 10000, 'uncollectible', m));

    // 12 direct charges spread monthly (no `invoice` field set).
    const charges = Array.from({ length: 12 }, (_, m) =>
      charge(`d${m}`, 5000, 'usd', { created: NOW_SEC - m * SEC_PER_MONTH }),
    );

    // 12 customers, 2 per month for last 6 months → ≥6 events for distribution.
    const customers = Array.from({ length: 12 }, (_, i) => customerAt(`c${i}`, i % 6));

    // 6 canceled subs spread monthly (1 per month over last 6m).
    const canceled = Array.from({ length: 6 }, (_, i) => cancelSub(12 + i, i));

    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getActiveSubscriptions: async () => [sub('s1', 5000)],
        getCustomers: async () => customers,
        getBilledInvoices: async () => billed,
        getCharges: async () => charges,
        getCanceledSubscriptions: async () => canceled,
      }),
    });

    const l2 = p.layer2!;
    expect(l2).toBeDefined();
    expect(l2.builtAt).toBe(NOW.toISOString());

    expect(l2.monthly_billed_revenue_series).toHaveLength(12);
    expect(l2.monthly_billed_revenue_series![0].currency).toBe('usd');

    expect(l2.monthly_recurring_billed_series).toHaveLength(12);

    expect(l2.monthly_collected_charges_series).toHaveLength(12);

    expect(l2.churn_distribution).toBeDefined();
    expect(l2.churn_distribution!.n_months).toBe(6);

    expect(l2.failed_payment_distribution).toBeDefined();

    expect(l2.new_customer_distribution).toBeDefined();

    expect(l2.top_customer_concentration).toBeDefined();
    expect(l2.top_customer_concentration!.currency).toBe('usd');

    expect(l2.avg_subscription_lifetime_days).toBeGreaterThan(0);

    expect(p.l2_build_error).toBeUndefined();
  });

  it('omits churn_distribution when total cancellations < 6', async () => {
    const canceled = Array.from({ length: 5 }, (_, i) => cancelSub(12 + i, i));
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({ getCanceledSubscriptions: async () => canceled }),
    });
    expect(p.layer2!.churn_distribution).toBeUndefined();
  });

  it('omits top_customer_concentration when customer_count < 10', async () => {
    const customers = Array.from({ length: 9 }, (_, i) => customerAt(`c${i}`, 0));
    const charges = Array.from({ length: 9 }, (_, i) =>
      charge(`d${i}`, 5000, 'usd', { created: NOW_SEC - 86400 }),
    );
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getCustomers: async () => customers,
        getCharges: async () => charges,
      }),
    });
    expect(p.layer2!.top_customer_concentration).toBeUndefined();
  });

  it('omits avg_subscription_lifetime_days when fewer than 6 valid cancellations', async () => {
    const canceled = Array.from({ length: 5 }, (_, i) => cancelSub(12 + i, i));
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({ getCanceledSubscriptions: async () => canceled }),
    });
    expect(p.layer2!.avg_subscription_lifetime_days).toBeUndefined();
  });

  it('monthly_collected_charges_series excludes charges that paid an invoice', async () => {
    // 12 direct charges + 12 invoice-paying charges (same months, same amount).
    // The series should reflect only direct charges (12 × $50 = $600/month).
    const charges: StripeChargeLike[] = [];
    for (let m = 0; m < 12; m++) {
      charges.push(charge(`d${m}`, 5000, 'usd', { created: NOW_SEC - m * SEC_PER_MONTH }));
      charges.push(
        charge(`i${m}`, 5000, 'usd', {
          created: NOW_SEC - m * SEC_PER_MONTH,
          invoice: `in_${m}`,
        }),
      );
    }
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({ getCharges: async () => charges }),
    });
    const series = p.layer2!.monthly_collected_charges_series!;
    expect(series).toHaveLength(12);
    // Each month should be $50 (one direct charge), not $100 (both charges).
    for (const row of series) {
      expect(row.amount).toBe(50);
    }
  });

  it('monthly_recurring_billed_series excludes non-recurring line items', async () => {
    // Mix: 12 months with one recurring invoice ($500) and one one-time invoice ($1000).
    // Recurring series should be $500/month, billed series should be $1500/month.
    const billed: StripeInvoiceLike[] = [];
    for (let m = 0; m < 12; m++) {
      billed.push(recurringInvoice(`r${m}`, 50000, 'paid', m, true));
      billed.push(recurringInvoice(`o${m}`, 100000, 'paid', m, false));
    }
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getActiveSubscriptions: async () => [sub('s1', 5000)],
        getBilledInvoices: async () => billed,
      }),
    });
    const recurring = p.layer2!.monthly_recurring_billed_series!;
    const total = p.layer2!.monthly_billed_revenue_series!;
    expect(recurring).toHaveLength(12);
    for (const row of recurring) expect(row.amount).toBe(500);
    for (const row of total) expect(row.amount).toBe(1500);
  });

  // Schema-gap regression test 2026-05-13 (PCL "$375 vs $371 drift investigation").
  // New-shape invoices use line.pricing.type='recurring' instead of legacy
  // line.price.recurring. Without dual-shape reading, monthly_recurring_billed_series
  // would silently produce zero on new-API merchants. This test exercises both shapes.
  it('monthly_recurring_billed_series — dual-shape: detects recurring via line.pricing.type (new API)', async () => {
    function newShapeInvoice(
      id: string,
      subtotal: number,
      monthsAgo: number,
      isRecurring: boolean,
    ): StripeInvoiceLike {
      const ts = NOW_SEC - monthsAgo * SEC_PER_MONTH;
      return {
        id,
        customer: `cus_${id}`,
        status: 'paid',
        subtotal,
        total: subtotal,
        total_excluding_tax: subtotal,
        amount_paid: subtotal,
        amount_due: 0,
        amount_remaining: 0,
        currency: 'usd',
        created: ts,
        status_transitions: {
          finalized_at: ts,
          paid_at: ts,
          voided_at: null,
          marked_uncollectible_at: null,
        },
        tax: 0,
        lines: {
          data: [
            {
              amount: subtotal,
              // NEW SHAPE — no line.price; line.pricing carries type
              pricing: {
                price_details: { price: 'price_1', product: 'prod_1' },
                type: isRecurring ? 'recurring' : 'one_time',
              },
            },
          ],
        },
      } as StripeInvoiceLike;
    }

    const billed: StripeInvoiceLike[] = [];
    for (let m = 0; m < 12; m++) {
      billed.push(newShapeInvoice(`nr${m}`, 50000, m, true));        // $500 recurring
      billed.push(newShapeInvoice(`no${m}`, 100000, m, false));      // $1000 one-time
    }
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getActiveSubscriptions: async () => [sub('s1', 5000)],
        getBilledInvoices: async () => billed,
      }),
    });
    const recurring = p.layer2!.monthly_recurring_billed_series!;
    const total = p.layer2!.monthly_billed_revenue_series!;
    expect(recurring).toHaveLength(12);
    for (const row of recurring) expect(row.amount).toBe(500);       // recurring-only
    for (const row of total) expect(row.amount).toBe(1500);          // all lines
  });

  it('monthly_recurring_billed_series — mixed legacy + new shape invoices both attribute correctly', async () => {
    // Half legacy-shape invoices, half new-shape invoices. Both should
    // resolve cleanly under dual-shape reading. Mirrors a real-world
    // merchant mid-API-migration (which is exactly what Merchant A
    // appears to be — older invoices retain legacy line.price, newer
    // invoices use line.pricing).
    const billed: StripeInvoiceLike[] = [];
    for (let m = 0; m < 6; m++) {
      // Legacy shape
      billed.push(recurringInvoice(`legacy_r${m}`, 25000, 'paid', m, true));
    }
    for (let m = 6; m < 12; m++) {
      // New shape — same $250 amount, marked recurring via pricing.type
      billed.push({
        id: `new_r${m}`,
        customer: `cus_new_r${m}`,
        status: 'paid',
        subtotal: 25000,
        total: 25000,
        total_excluding_tax: 25000,
        amount_paid: 25000,
        amount_due: 0,
        amount_remaining: 0,
        currency: 'usd',
        created: NOW_SEC - m * SEC_PER_MONTH,
        status_transitions: {
          finalized_at: NOW_SEC - m * SEC_PER_MONTH,
          paid_at: NOW_SEC - m * SEC_PER_MONTH,
          voided_at: null,
          marked_uncollectible_at: null,
        },
        tax: 0,
        lines: {
          data: [
            {
              amount: 25000,
              pricing: {
                price_details: { price: 'price_1', product: 'prod_1' },
                type: 'recurring',
              },
            },
          ],
        },
      } as StripeInvoiceLike);
    }
    const p = await buildProfile({
      mode: 'live',
      now: NOW,
      deps: makeDeps({
        getActiveSubscriptions: async () => [sub('s1', 5000)],
        getBilledInvoices: async () => billed,
      }),
    });
    const recurring = p.layer2!.monthly_recurring_billed_series!;
    expect(recurring).toHaveLength(12);
    // All 12 months should report $250 — both shape paths resolved correctly
    for (const row of recurring) expect(row.amount).toBe(250);
  });
});

// ── isLayer2Stale ───────────────────────────────────────────────────────────

describe('isLayer2Stale', () => {
  const NOW_DATE = new Date(Date.UTC(2026, 3, 23, 12, 0, 0));
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const ONE_DAY_MS = 24 * ONE_HOUR_MS;

  function profile(overrides: Partial<Profile> = {}): Profile {
    return {
      version: PROFILE_SCHEMA_VERSION,
      mode: 'live',
      layer1: { builtAt: NOW_DATE.toISOString() },
      ...overrides,
    };
  }

  it('layer2 missing, no error → triggers rebuild (fresh first-build)', () => {
    expect(isLayer2Stale(profile(), NOW_DATE)).toBe(true);
  });

  it('layer2 missing, error <24h old → does NOT rebuild (wait the cooldown)', () => {
    const recentError = new Date(NOW_DATE.getTime() - 12 * ONE_HOUR_MS).toISOString();
    const p = profile({
      l2_build_error: { at: recentError, reason: 'test', attempt_count: 1 },
    });
    expect(isLayer2Stale(p, NOW_DATE)).toBe(false);
  });

  it('layer2 missing, error >24h old → triggers auto-retry rebuild', () => {
    const oldError = new Date(NOW_DATE.getTime() - 25 * ONE_HOUR_MS).toISOString();
    const p = profile({
      l2_build_error: { at: oldError, reason: 'test', attempt_count: 3 },
    });
    expect(isLayer2Stale(p, NOW_DATE)).toBe(true);
  });

  it('layer2 fresh (<30 days) → no rebuild', () => {
    const recentBuild = new Date(NOW_DATE.getTime() - 7 * ONE_DAY_MS).toISOString();
    const p = profile({ layer2: { builtAt: recentBuild } });
    expect(isLayer2Stale(p, NOW_DATE)).toBe(false);
  });

  it('layer2 stale (>30 days) → triggers rebuild', () => {
    const oldBuild = new Date(NOW_DATE.getTime() - 31 * ONE_DAY_MS).toISOString();
    const p = profile({ layer2: { builtAt: oldBuild } });
    expect(isLayer2Stale(p, NOW_DATE)).toBe(true);
  });
});
