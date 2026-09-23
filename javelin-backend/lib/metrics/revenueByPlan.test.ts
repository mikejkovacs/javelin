import { describe, it, expect } from 'vitest';
import { revenueByPlan } from './revenueByPlan';
import type { StripeChargeLike } from './chargeEnriched';
import type { StripeInvoiceLike } from './invoiceEnriched';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const MARCH_2026 = {
  start: Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};

const MAR_05 = Math.floor(Date.UTC(2026, 2, 5, 0, 0, 0) / 1000);
const MAR_15 = Math.floor(Date.UTC(2026, 2, 15, 0, 0, 0) / 1000);
const MAR_25 = Math.floor(Date.UTC(2026, 2, 25, 0, 0, 0) / 1000);

function charge(
  id: string,
  amount_minor: number,
  invoice: string | null,
  created = MAR_05,
  currency = 'usd',
  amount_refunded = 0,
): StripeChargeLike {
  return {
    id,
    customer: 'cus_x',
    amount: amount_minor,
    amount_refunded,
    currency,
    status: 'succeeded',
    created,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    invoice,
  };
}

function invoice(
  id: string,
  plan_nickname: string | null,
  product_id: string = 'prod_x',
): StripeInvoiceLike {
  return {
    id,
    customer: 'cus_x',
    status: 'paid',
    total: 0,
    subtotal: 0,
    total_excluding_tax: null,
    tax: null,
    amount_paid: 0,
    amount_due: 0,
    amount_remaining: 0,
    currency: 'usd',
    created: MAR_05,
    lines: {
      data: [
        {
          price: {
            id: 'price_x',
            product: product_id,
            nickname: plan_nickname,
          },
        },
      ],
    },
  };
}

describe('revenue_by_plan', () => {
  it('groups charges by plan_name from invoice line nickname', () => {
    const r = revenueByPlan({
      charges: [
        charge('a', 100000, 'in_pro'), // $1,000 Pro
        charge('b', 50000, 'in_starter'), // $500 Starter
        charge('c', 200000, 'in_pro'), // $2,000 Pro
      ],
      invoices: [
        invoice('in_pro', 'Pro Monthly'),
        invoice('in_starter', 'Starter Monthly'),
      ],
      period: MARCH_2026,
      currency: 'usd',
      now: NOW,
    });
    expect(r.rows).toHaveLength(2);
    // Sorted desc — Pro first
    expect(r.rows[0].plan_name).toBe('Pro Monthly');
    expect(r.rows[0].amount).toBe(3000);
    expect(r.rows[0].charge_count).toBe(2);
    expect(r.rows[1].plan_name).toBe('Starter Monthly');
    expect(r.rows[1].amount).toBe(500);
    expect(r.total).toBe(3500);
  });

  it('charges without invoice → unattributed', () => {
    const r = revenueByPlan({
      charges: [
        charge('a', 100000, 'in_pro'),
        charge('b', 50000, null), // direct charge, no invoice
      ],
      invoices: [invoice('in_pro', 'Pro Monthly')],
      period: MARCH_2026,
      currency: 'usd',
      now: NOW,
    });
    expect(r.rows).toHaveLength(2);
    const unattributed = r.rows.find((row) => row.plan_name === 'unattributed');
    expect(unattributed?.amount).toBe(500);
  });

  it('invoice with null nickname falls back to product.name when expanded', () => {
    const inv: StripeInvoiceLike = {
      ...invoice('in_x', null),
      lines: {
        data: [
          {
            price: {
              id: 'price_x',
              product: { id: 'prod_x', name: 'Enterprise Plan' },
              nickname: null,
            },
          },
        ],
      },
    };
    const r = revenueByPlan({
      charges: [charge('a', 100000, 'in_x')],
      invoices: [inv],
      period: MARCH_2026,
      currency: 'usd',
      now: NOW,
    });
    expect(r.rows[0].plan_name).toBe('Enterprise Plan');
  });

  it('null nickname AND no products map → unattributed (no productById match)', () => {
    const r = revenueByPlan({
      charges: [charge('a', 100000, 'in_x')],
      invoices: [invoice('in_x', null)],
      period: MARCH_2026,
      currency: 'usd',
      now: NOW,
    });
    expect(r.rows[0].plan_name).toBe('unattributed');
  });

  // ── Phase 2C-post — product-name fallback ──────────────────────────────
  describe('product-name fallback (Phase 2C-post)', () => {
    it('null nickname + product ID in productById map → returns product.name', () => {
      // Production scenario: invoice carries nickname:null, product is a
      // string ID (not expanded due to Stripe expand-depth cap), and the
      // products fetcher populates the lookup map.
      const r = revenueByPlan({
        charges: [charge('a', 2500, 'in_advice', MAR_05)], // CA$25 in minor
        invoices: [invoice('in_advice', null, 'prod_advice_access')],
        products: [
          { id: 'prod_advice_access', name: 'Advice Access', active: true },
        ],
        period: MARCH_2026,
        currency: 'usd',
        now: NOW,
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].plan_name).toBe('Advice Access');
      expect(r.rows[0].amount).toBe(25);
    });

    it('null nickname + product ID NOT in productById map → unattributed', () => {
      // Edge case: invoice references a product that wasn't in the products
      // fetch (deleted between fetches, or pagination cap). Fall through to
      // unattributed rather than blowing up.
      const r = revenueByPlan({
        charges: [charge('a', 2500, 'in_advice', MAR_05)],
        invoices: [invoice('in_advice', null, 'prod_missing')],
        products: [
          { id: 'prod_other', name: 'Other Product', active: true },
        ],
        period: MARCH_2026,
        currency: 'usd',
        now: NOW,
      });
      expect(r.rows[0].plan_name).toBe('unattributed');
    });

    it('nickname-set takes precedence over product name (when both exist)', () => {
      // Nickname is the primary path; product-name fallback fires only when
      // nickname is unset.
      const r = revenueByPlan({
        charges: [charge('a', 100000, 'in_pro')],
        invoices: [invoice('in_pro', 'Pro Monthly', 'prod_pro')],
        products: [{ id: 'prod_pro', name: 'Pro', active: true }],
        period: MARCH_2026,
        currency: 'usd',
        now: NOW,
      });
      expect(r.rows[0].plan_name).toBe('Pro Monthly');
    });

    it('series mode — product-name fallback resolves per bucket', () => {
      // Series mode uses the same planNameFromInvoice() resolution; this
      // confirms the productById map is wired through revenueByPlanSeries
      // alongside the rows path.
      const r = revenueByPlan({
        charges: [
          charge('a', 2500, 'in_advice_a', MAR_05), // CA$25 March
          charge('b', 2500, 'in_advice_b', Math.floor(Date.UTC(2026, 2, 25, 12, 0, 0) / 1000)), // CA$25 March 25
        ],
        invoices: [
          invoice('in_advice_a', null, 'prod_advice_access'),
          invoice('in_advice_b', null, 'prod_advice_access'),
        ],
        products: [
          { id: 'prod_advice_access', name: 'Advice Access', active: true },
        ],
        period: MARCH_2026,
        currency: 'usd',
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.plans).toHaveLength(1);
      expect(r.plans[0].plan_name).toBe('Advice Access');
      expect(r.plans[0].total).toBe(50);
      expect(r.plans[0].charge_count).toBe(2);
    });
  });

  it('subtracts refunds from charge amount', () => {
    const r = revenueByPlan({
      charges: [
        charge('a', 100000, 'in_pro', MAR_05, 'usd', 30000), // $1000 - $300 refund
      ],
      invoices: [invoice('in_pro', 'Pro Monthly')],
      period: MARCH_2026,
      currency: 'usd',
      now: NOW,
    });
    expect(r.rows[0].amount).toBe(700);
  });

  it('fully refunded charges excluded', () => {
    const r = revenueByPlan({
      charges: [
        charge('a', 100000, 'in_pro', MAR_05, 'usd', 100000), // fully refunded
        charge('b', 50000, 'in_pro'),
      ],
      invoices: [invoice('in_pro', 'Pro Monthly')],
      period: MARCH_2026,
      currency: 'usd',
      now: NOW,
    });
    expect(r.rows[0].charge_count).toBe(1);
    expect(r.rows[0].amount).toBe(500);
  });

  it('cross-currency charges excluded by target currency filter', () => {
    const r = revenueByPlan({
      charges: [
        charge('a', 100000, 'in_pro', MAR_05, 'usd'),
        charge('b', 80000, 'in_pro', MAR_15, 'eur'), // different currency
      ],
      invoices: [invoice('in_pro', 'Pro Monthly')],
      period: MARCH_2026,
      currency: 'usd',
      now: NOW,
    });
    expect(r.rows[0].amount).toBe(1000);
    expect(r.rows[0].charge_count).toBe(1);
  });

  it('shares sum to ~1 (or 0 if no revenue)', () => {
    const r = revenueByPlan({
      charges: [charge('a', 100000, 'in_pro'), charge('b', 50000, null)],
      invoices: [invoice('in_pro', 'Pro Monthly')],
      period: MARCH_2026,
      currency: 'usd',
      now: NOW,
    });
    const sum = r.rows.reduce((acc, row) => acc + row.share, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('empty input → empty rows, total 0', () => {
    const r = revenueByPlan({
      charges: [],
      invoices: [],
      period: MARCH_2026,
      currency: 'usd',
      now: NOW,
    });
    expect(r.rows).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it('output envelope: rows kind, currency unit, definition + as_of + period', () => {
    const r = revenueByPlan({
      charges: [],
      invoices: [],
      period: MARCH_2026,
      currency: 'usd',
      now: NOW,
    });
    expect(r.kind).toBe('rows');
    expect(r.unit).toBe('usd');
    expect(r.currency).toBe('usd');
    expect(r.definition).toBe('javelin_defined.revenue_by_plan');
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.period).toEqual(MARCH_2026);
  });

  // ── Phase 2C — series mode ──────────────────────────────────────────────
  describe('series mode', () => {
    it('granularity=month → one bucket per month, plans aligned, dense', () => {
      const r = revenueByPlan({
        charges: [
          charge('a', 100000, 'in_pro', MAR_05),  // $1,000 Pro Mar
          charge('b', 50000, 'in_starter', MAR_15), // $500 Starter Mar
          charge('c', 200000, 'in_pro', MAR_25),  // $2,000 Pro Mar
        ],
        invoices: [
          invoice('in_pro', 'Pro Monthly'),
          invoice('in_starter', 'Starter Monthly'),
        ],
        period: MARCH_2026,
        currency: 'usd',
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.kind).toBe('series');
      expect(r.granularity).toBe('month');
      expect(r.buckets).toEqual(['2026-03']);
      expect(r.plans).toHaveLength(2);
      // Sorted desc by total — Pro first
      expect(r.plans[0].plan_name).toBe('Pro Monthly');
      expect(r.plans[0].total).toBe(3000);
      expect(r.plans[0].charge_count).toBe(2);
      expect(r.plans[0].series).toHaveLength(1);
      expect(r.plans[0].series[0]).toEqual({
        bucket: '2026-03',
        amount: 3000,
        charge_count: 2,
      });
      expect(r.plans[1].plan_name).toBe('Starter Monthly');
      expect(r.plans[1].total).toBe(500);
      expect(r.total).toBe(3500);
    });

    it('granularity=day → dense zero-fill across empty days', () => {
      // 5-day period, charge only on day 3. Other 4 days emit zeros.
      const startSec = Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000);
      const endSec = Math.floor(Date.UTC(2026, 2, 5, 23, 59, 59) / 1000);
      const day3 = Math.floor(Date.UTC(2026, 2, 3, 12, 0, 0) / 1000);
      const r = revenueByPlan({
        charges: [charge('a', 100000, 'in_pro', day3)],
        invoices: [invoice('in_pro', 'Pro Monthly')],
        period: { start: startSec, end: endSec },
        currency: 'usd',
        now: NOW,
        granularity: 'day',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.buckets).toEqual([
        '2026-03-01',
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
      ]);
      expect(r.plans).toHaveLength(1);
      expect(r.plans[0].series).toHaveLength(5);
      // Days 1, 2, 4, 5 zero-filled
      expect(r.plans[0].series[0]).toEqual({ bucket: '2026-03-01', amount: 0, charge_count: 0 });
      expect(r.plans[0].series[1]).toEqual({ bucket: '2026-03-02', amount: 0, charge_count: 0 });
      expect(r.plans[0].series[2]).toEqual({ bucket: '2026-03-03', amount: 1000, charge_count: 1 });
      expect(r.plans[0].series[3]).toEqual({ bucket: '2026-03-04', amount: 0, charge_count: 0 });
      expect(r.plans[0].series[4]).toEqual({ bucket: '2026-03-05', amount: 0, charge_count: 0 });
    });

    it('granularity=week → ISO Monday-start buckets, plans bucket-aligned', () => {
      // March 2026: weeks starting 2026-02-23, 2026-03-02, 2026-03-09, 2026-03-16, 2026-03-23, 2026-03-30
      const r = revenueByPlan({
        charges: [
          charge('a', 100000, 'in_pro', MAR_05),  // week 2026-03-02
          charge('b', 200000, 'in_pro', MAR_15),  // week 2026-03-09 (Sun)
          charge('c', 50000, 'in_starter', MAR_25), // week 2026-03-23
        ],
        invoices: [
          invoice('in_pro', 'Pro Monthly'),
          invoice('in_starter', 'Starter Monthly'),
        ],
        period: MARCH_2026,
        currency: 'usd',
        now: NOW,
        granularity: 'week',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.buckets).toEqual([
        '2026-02-23',
        '2026-03-02',
        '2026-03-09',
        '2026-03-16',
        '2026-03-23',
        '2026-03-30',
      ]);
      const pro = r.plans.find((p) => p.plan_name === 'Pro Monthly')!;
      expect(pro.series.map((p) => p.amount)).toEqual([0, 1000, 2000, 0, 0, 0]);
      const starter = r.plans.find((p) => p.plan_name === 'Starter Monthly')!;
      expect(starter.series.map((p) => p.amount)).toEqual([0, 0, 0, 0, 500, 0]);
    });

    it('series excludes cross-currency charges (matches rows mode behavior)', () => {
      const r = revenueByPlan({
        charges: [
          charge('a', 100000, 'in_pro', MAR_05, 'usd'),
          charge('b', 80000, 'in_pro', MAR_15, 'eur'), // dropped
        ],
        invoices: [invoice('in_pro', 'Pro Monthly')],
        period: MARCH_2026,
        currency: 'usd',
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.plans[0].total).toBe(1000);
      expect(r.plans[0].charge_count).toBe(1);
      expect(r.total).toBe(1000);
    });

    it('empty period → empty plans array, dense buckets still emitted', () => {
      const r = revenueByPlan({
        charges: [],
        invoices: [],
        period: MARCH_2026,
        currency: 'usd',
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.plans).toHaveLength(0);
      expect(r.buckets).toEqual(['2026-03']);
      expect(r.total).toBe(0);
    });

    it('output envelope: series kind, granularity, definition, as_of, period', () => {
      const r = revenueByPlan({
        charges: [],
        invoices: [],
        period: MARCH_2026,
        currency: 'usd',
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.kind).toBe('series');
      expect(r.granularity).toBe('month');
      expect(r.unit).toBe('usd');
      expect(r.currency).toBe('usd');
      expect(r.definition).toBe('javelin_defined.revenue_by_plan');
      expect(r.as_of).toBe(NOW_SEC);
      expect(r.period).toEqual(MARCH_2026);
    });
  });
});
