import { describe, it, expect } from 'vitest';
import { growthAttribution } from './growthAttribution';
import type { StripeCustomerLike } from './mrrMovement';
import type { StripeInvoiceLike, StripeInvoiceLineItemLike } from './invoiceEnriched';
import type { StripeSubscriptionLike } from './subscriptionEnriched';
import type { StripeProductLike } from './revenueByPlan';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));

const MAR_05 = Math.floor(Date.UTC(2026, 2, 5, 0, 0, 0) / 1000);
const MAR_15 = Math.floor(Date.UTC(2026, 2, 15, 0, 0, 0) / 1000);
const MAR_25 = Math.floor(Date.UTC(2026, 2, 25, 0, 0, 0) / 1000);
const APR_05 = Math.floor(Date.UTC(2026, 3, 5, 0, 0, 0) / 1000);
const APR_15 = Math.floor(Date.UTC(2026, 3, 15, 0, 0, 0) / 1000);

const MARCH_2026 = {
  start: Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};

const Q1_2026 = {
  start: Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};

// ── Builders (mirror mrrMovement.test.ts) ─────────────────────────────────

function legacyLine(
  amount: number,
  opts: { nickname?: string | null; productId?: string; recurring?: boolean } = {},
): StripeInvoiceLineItemLike {
  return {
    amount,
    price: {
      id: 'price_x',
      product: opts.productId ?? 'prod_x',
      nickname: opts.nickname ?? null,
      recurring: opts.recurring !== false
        ? { interval: 'month', interval_count: 1 }
        : null,
    },
  };
}

function invoice(opts: {
  id: string;
  subscriptionId: string;
  status?: 'paid' | 'open' | 'uncollectible' | 'void' | 'draft';
  finalizedAt: number;
  currency?: string;
  customerId?: string;
  lines: StripeInvoiceLineItemLike[];
}): StripeInvoiceLike {
  return {
    id: opts.id,
    customer: opts.customerId ?? 'cus_x',
    status: opts.status ?? 'paid',
    total: 0,
    subtotal: 0,
    total_excluding_tax: null,
    tax: null,
    amount_paid: 0,
    amount_due: 0,
    amount_remaining: 0,
    currency: opts.currency ?? 'usd',
    created: opts.finalizedAt,
    status_transitions: {
      finalized_at: opts.finalizedAt,
      paid_at: opts.status === 'paid' || !opts.status ? opts.finalizedAt : null,
      voided_at: opts.status === 'void' ? opts.finalizedAt : null,
      marked_uncollectible_at:
        opts.status === 'uncollectible' ? opts.finalizedAt : null,
    },
    lines: { data: opts.lines },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ subscription: opts.subscriptionId } as any),
  };
}

function subscription(opts: {
  id: string;
  customerId?: string;
  startDate: number;
  endedAt?: number | null;
  status?: string;
  unitAmount?: number;
  productId?: string;
  currency?: string;
}): StripeSubscriptionLike {
  return {
    id: opts.id,
    customer: opts.customerId ?? 'cus_x',
    status: opts.status ?? (opts.endedAt ? 'canceled' : 'active'),
    start_date: opts.startDate,
    canceled_at: opts.endedAt ?? null,
    ended_at: opts.endedAt ?? null,
    cancellation_details: null,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    items: {
      data: [
        {
          id: 'si_x',
          quantity: 1,
          price: {
            id: 'price_x',
            nickname: null,
            unit_amount: opts.unitAmount ?? 2500,
            currency: opts.currency ?? 'usd',
            product: opts.productId ?? 'prod_x',
            recurring: {
              interval: 'month',
              interval_count: 1,
              usage_type: 'licensed',
            },
          },
        },
      ],
    },
  };
}

const PRODUCTS: StripeProductLike[] = [
  { id: 'prod_advice_access', name: 'Advice Access', active: true },
  { id: 'prod_pro', name: 'Pro Monthly', active: true },
  { id: 'prod_starter', name: 'Starter', active: true },
  { id: 'prod_enterprise', name: 'Enterprise', active: true },
];

const CUSTOMERS: StripeCustomerLike[] = [
  { id: 'cus_acme', name: 'Acme Corp', email: 'ops@acme.com' },
  { id: 'cus_beta', name: 'Beta Industries', email: 'beta@example.com' },
  { id: 'cus_solo', name: null, email: 'solo@example.com' },
];

describe('growthAttribution', () => {
  // ── Envelope basics ──────────────────────────────────────────────────────

  it('empty events: returns empty rows + empty totals + envelope flags set', () => {
    const r = growthAttribution({
      invoices: [],
      activeSubscriptions: [],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.kind).toBe('rows');
    expect(r.rows).toEqual([]);
    expect(r.totals_by_currency).toEqual({});
    expect(r.truncated).toBe(false);
    expect(r.dimension).toBe('plan');
    expect(r.scope).toBe('subscription_mrr');
    expect(r.metric_type).toBe('flow');
    expect(r.coverage_starts_at).toBeNull();
    expect(r.definition).toBe('javelin_defined.growth_attribution');
    expect(r.period).toEqual(MARCH_2026);
  });

  // ── Single-event aggregation ─────────────────────────────────────────────

  it('single new event: one plan row with new_mrr populated and other buckets zero', () => {
    const sub = subscription({
      id: 'sub_1',
      customerId: 'cus_acme',
      startDate: MAR_05,
      productId: 'prod_pro',
    });
    const inv = invoice({
      id: 'in_1',
      subscriptionId: 'sub_1',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const r = growthAttribution({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].plan_name).toBe('Pro Monthly');
    expect(r.rows[0].currency).toBe('usd');
    expect(r.rows[0].new_mrr).toBe(25);
    expect(r.rows[0].expansion_mrr).toBe(0);
    expect(r.rows[0].contraction_mrr).toBe(0);
    expect(r.rows[0].churned_mrr).toBe(0);
    expect(r.rows[0].net_contribution).toBe(25);
    expect(r.rows[0].pct_of_net_growth).toBe(1);     // 25 / 25 = 1.0
    expect(r.rows[0].event_count).toBe(1);
    expect(r.totals_by_currency.usd.new).toBe(25);
    expect(r.totals_by_currency.usd.net).toBe(25);
    expect(r.totals_by_currency.usd.plan_count).toBe(1);
  });

  // ── Same-plan multi-event aggregation ────────────────────────────────────

  it('same plan, multiple events: buckets sum and event_count increments', () => {
    // Two new subs same plan, plus one churned
    const subA = subscription({
      id: 'sub_a',
      customerId: 'cus_acme',
      startDate: MAR_05,
      productId: 'prod_pro',
    });
    const subB = subscription({
      id: 'sub_b',
      customerId: 'cus_beta',
      startDate: MAR_15,
      productId: 'prod_pro',
    });
    const subC = subscription({
      id: 'sub_c',
      customerId: 'cus_solo',
      startDate: 1, // way before period
      endedAt: MAR_25,
      productId: 'prod_pro',
    });
    const invA = invoice({
      id: 'in_a',
      subscriptionId: 'sub_a',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const invB = invoice({
      id: 'in_b',
      subscriptionId: 'sub_b',
      finalizedAt: MAR_15,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const invC = invoice({
      id: 'in_c',
      subscriptionId: 'sub_c',
      finalizedAt: MAR_15,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const r = growthAttribution({
      invoices: [invA, invB, invC],
      activeSubscriptions: [subA, subB],
      canceledSubscriptions: [subC],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].plan_name).toBe('Pro Monthly');
    expect(r.rows[0].new_mrr).toBe(50);              // 2 new at $25
    expect(r.rows[0].churned_mrr).toBe(-25);         // 1 churned at $25
    expect(r.rows[0].net_contribution).toBe(25);
    expect(r.rows[0].event_count).toBe(3);
    expect(r.totals_by_currency.usd.plan_count).toBe(1);
  });

  // ── Multi-plan aggregation + sort by |net| desc ──────────────────────────

  it('multiple plans: rows sorted by |net_contribution| desc', () => {
    // Pro: +$100 (4 new at $25)
    // Starter: -$50 (2 churned at $25)
    // Advice Access: +$25 (1 new)
    // Expected order by |net|: Pro (100), Starter (-50), Advice Access (25)
    const subs = [
      subscription({ id: 'sub_p1', startDate: MAR_05, productId: 'prod_pro' }),
      subscription({ id: 'sub_p2', startDate: MAR_05, productId: 'prod_pro' }),
      subscription({ id: 'sub_p3', startDate: MAR_05, productId: 'prod_pro' }),
      subscription({ id: 'sub_p4', startDate: MAR_05, productId: 'prod_pro' }),
      subscription({ id: 'sub_a', startDate: MAR_05, productId: 'prod_advice_access' }),
    ];
    const churned = [
      subscription({ id: 'sub_s1', startDate: 1, endedAt: MAR_15, productId: 'prod_starter' }),
      subscription({ id: 'sub_s2', startDate: 1, endedAt: MAR_15, productId: 'prod_starter' }),
    ];
    const invoices = [
      invoice({ id: 'i_p1', subscriptionId: 'sub_p1', finalizedAt: MAR_05, lines: [legacyLine(2500, { productId: 'prod_pro' })] }),
      invoice({ id: 'i_p2', subscriptionId: 'sub_p2', finalizedAt: MAR_05, lines: [legacyLine(2500, { productId: 'prod_pro' })] }),
      invoice({ id: 'i_p3', subscriptionId: 'sub_p3', finalizedAt: MAR_05, lines: [legacyLine(2500, { productId: 'prod_pro' })] }),
      invoice({ id: 'i_p4', subscriptionId: 'sub_p4', finalizedAt: MAR_05, lines: [legacyLine(2500, { productId: 'prod_pro' })] }),
      invoice({ id: 'i_a', subscriptionId: 'sub_a', finalizedAt: MAR_05, lines: [legacyLine(2500, { productId: 'prod_advice_access' })] }),
      invoice({ id: 'i_s1', subscriptionId: 'sub_s1', finalizedAt: MAR_15, lines: [legacyLine(2500, { productId: 'prod_starter' })] }),
      invoice({ id: 'i_s2', subscriptionId: 'sub_s2', finalizedAt: MAR_15, lines: [legacyLine(2500, { productId: 'prod_starter' })] }),
    ];
    const r = growthAttribution({
      invoices,
      activeSubscriptions: subs,
      canceledSubscriptions: churned,
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].plan_name).toBe('Pro Monthly');
    expect(r.rows[0].net_contribution).toBe(100);
    expect(r.rows[1].plan_name).toBe('Starter');
    expect(r.rows[1].net_contribution).toBe(-50);
    expect(r.rows[2].plan_name).toBe('Advice Access');
    expect(r.rows[2].net_contribution).toBe(25);
    expect(r.totals_by_currency.usd.plan_count).toBe(3);
    expect(r.totals_by_currency.usd.net).toBe(75);
  });

  // ── Multi-currency ───────────────────────────────────────────────────────

  it('multi-currency: per-(plan, currency) rows; no FX', () => {
    const subUsd = subscription({
      id: 'sub_usd',
      startDate: MAR_05,
      productId: 'prod_pro',
      currency: 'usd',
      unitAmount: 2500,
    });
    const subCad = subscription({
      id: 'sub_cad',
      startDate: MAR_05,
      productId: 'prod_pro',
      currency: 'cad',
      unitAmount: 3500,
    });
    const invUsd = invoice({
      id: 'iu',
      subscriptionId: 'sub_usd',
      finalizedAt: MAR_05,
      currency: 'usd',
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const invCad = invoice({
      id: 'ic',
      subscriptionId: 'sub_cad',
      finalizedAt: MAR_05,
      currency: 'cad',
      lines: [legacyLine(3500, { productId: 'prod_pro' })],
    });
    const r = growthAttribution({
      invoices: [invUsd, invCad],
      activeSubscriptions: [subUsd, subCad],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(2);
    const usdRow = r.rows.find((x) => x.currency === 'usd');
    const cadRow = r.rows.find((x) => x.currency === 'cad');
    expect(usdRow?.new_mrr).toBe(25);
    expect(cadRow?.new_mrr).toBe(35);
    expect(r.totals_by_currency.usd.net).toBe(25);
    expect(r.totals_by_currency.cad.net).toBe(35);
    expect(r.totals_by_currency.usd.plan_count).toBe(1);
    expect(r.totals_by_currency.cad.plan_count).toBe(1);
  });

  // ── pct_of_net_growth ────────────────────────────────────────────────────

  it('pct_of_net_growth: null when period net is zero', () => {
    // +$50 expansion and -$50 churned in same period → period_net = 0
    const subExp = subscription({
      id: 'sub_exp',
      startDate: 1, // way before period
      productId: 'prod_pro',
      unitAmount: 5000,
    });
    const invExpPrev = invoice({
      id: 'i_exp_prev',
      subscriptionId: 'sub_exp',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const invExpCurr = invoice({
      id: 'i_exp_curr',
      subscriptionId: 'sub_exp',
      finalizedAt: MAR_25,
      lines: [legacyLine(7500, { productId: 'prod_pro' })],  // +$50 expansion
    });
    const subChurn = subscription({
      id: 'sub_chu',
      startDate: 1,
      endedAt: MAR_15,
      productId: 'prod_starter',
      unitAmount: 5000,
    });
    const invChurn = invoice({
      id: 'i_chu',
      subscriptionId: 'sub_chu',
      finalizedAt: MAR_05,
      lines: [legacyLine(5000, { productId: 'prod_starter' })],
    });
    const r = growthAttribution({
      invoices: [invExpPrev, invExpCurr, invChurn],
      activeSubscriptions: [subExp],
      canceledSubscriptions: [subChurn],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.totals_by_currency.usd.net).toBe(0);
    for (const row of r.rows) {
      expect(row.pct_of_net_growth).toBeNull();
    }
  });

  it('pct_of_net_growth: mixed-sign case preserves sign (plan grew on declining period)', () => {
    // Period net = -$75 (one new +$25, two churned -$50 each = -$100, +$25 = -$75)
    // Pro plan: +$25 (grew); Starter: -$100 (declined)
    // Pro pct = +25 / -75 = -0.333... (plan mitigated decline)
    // Starter pct = -100 / -75 = 1.333... (plan was 133% of decline magnitude)
    const subPro = subscription({
      id: 'sub_pro',
      startDate: MAR_05,
      productId: 'prod_pro',
    });
    const subS1 = subscription({
      id: 'sub_s1',
      startDate: 1,
      endedAt: MAR_15,
      productId: 'prod_starter',
      unitAmount: 5000,
    });
    const subS2 = subscription({
      id: 'sub_s2',
      startDate: 1,
      endedAt: MAR_15,
      productId: 'prod_starter',
      unitAmount: 5000,
    });
    const invoices = [
      invoice({ id: 'i_pro', subscriptionId: 'sub_pro', finalizedAt: MAR_05, lines: [legacyLine(2500, { productId: 'prod_pro' })] }),
      invoice({ id: 'i_s1', subscriptionId: 'sub_s1', finalizedAt: MAR_05, lines: [legacyLine(5000, { productId: 'prod_starter' })] }),
      invoice({ id: 'i_s2', subscriptionId: 'sub_s2', finalizedAt: MAR_05, lines: [legacyLine(5000, { productId: 'prod_starter' })] }),
    ];
    const r = growthAttribution({
      invoices,
      activeSubscriptions: [subPro],
      canceledSubscriptions: [subS1, subS2],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.totals_by_currency.usd.net).toBe(-75);
    const proRow = r.rows.find((x) => x.plan_name === 'Pro Monthly')!;
    const starterRow = r.rows.find((x) => x.plan_name === 'Starter')!;
    expect(proRow.pct_of_net_growth).toBeCloseTo(-0.333, 2);   // grew on declining period → negative
    expect(starterRow.pct_of_net_growth).toBeCloseTo(1.333, 2); // 133% of decline magnitude
  });

  // ── Reconciliation: rows sum to totals_by_currency ───────────────────────

  it('reconciliation: rows per currency sum to totals_by_currency.net (including Other rollup)', () => {
    // Build 22 plans of $25 each to force the "Other (2 plans)" rollup
    const products: StripeProductLike[] = [];
    const subs: StripeSubscriptionLike[] = [];
    const invoices: StripeInvoiceLike[] = [];
    for (let i = 0; i < 22; i++) {
      const productId = `prod_plan_${i}`;
      products.push({ id: productId, name: `Plan ${i}`, active: true });
      subs.push(
        subscription({
          id: `sub_${i}`,
          startDate: MAR_05,
          productId,
          unitAmount: 2500 + i * 100,        // distinct per plan so sort is determinate
        }),
      );
      invoices.push(
        invoice({
          id: `i_${i}`,
          subscriptionId: `sub_${i}`,
          finalizedAt: MAR_05,
          lines: [legacyLine(2500 + i * 100, { productId })],
        }),
      );
    }
    const r = growthAttribution({
      invoices,
      activeSubscriptions: subs,
      canceledSubscriptions: [],
      products,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.truncated).toBe(true);
    expect(r.rows.length).toBe(21);                     // top 20 + 1 "Other"
    const otherRow = r.rows.find((x) => x.plan_name.startsWith('Other ('));
    expect(otherRow).toBeDefined();
    expect(otherRow!.plan_name).toBe('Other (2 plans)');
    // Reconciliation: sum of rows[].net_contribution = totals_by_currency.usd.net
    const rowSum = r.rows.reduce((acc, row) => acc + row.net_contribution, 0);
    expect(rowSum).toBeCloseTo(r.totals_by_currency.usd.net, 6);
    expect(r.totals_by_currency.usd.plan_count).toBe(22);
  });

  it('truncation only with >20 distinct (plan, currency) rows', () => {
    // 20 plans exactly → no "Other" row, truncated=false
    const products: StripeProductLike[] = [];
    const subs: StripeSubscriptionLike[] = [];
    const invoices: StripeInvoiceLike[] = [];
    for (let i = 0; i < 20; i++) {
      const productId = `prod_plan_${i}`;
      products.push({ id: productId, name: `Plan ${i}`, active: true });
      subs.push(
        subscription({
          id: `sub_${i}`,
          startDate: MAR_05,
          productId,
        }),
      );
      invoices.push(
        invoice({
          id: `i_${i}`,
          subscriptionId: `sub_${i}`,
          finalizedAt: MAR_05,
          lines: [legacyLine(2500, { productId })],
        }),
      );
    }
    const r = growthAttribution({
      invoices,
      activeSubscriptions: subs,
      canceledSubscriptions: [],
      products,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.truncated).toBe(false);
    expect(r.rows.length).toBe(20);
    expect(r.rows.find((x) => x.plan_name.startsWith('Other ('))).toBeUndefined();
  });

  // ── Per-currency Other rollup ────────────────────────────────────────────

  it('truncation with multi-currency: separate "Other" row per currency', () => {
    // 12 USD plans + 12 CAD plans = 24 distinct (plan, currency) tuples.
    // Top 20 (sorted by |net|) leaves 4 tail tuples. The tail should split
    // by currency, producing one "Other" row per currency that has tail
    // entries. Concrete split is determined by sort order; we just assert
    // structural invariants:
    //   - truncated = true
    //   - at least one Other (N plans) row exists
    //   - rows per currency sum to totals_by_currency[currency].net
    const products: StripeProductLike[] = [];
    const subs: StripeSubscriptionLike[] = [];
    const invoices: StripeInvoiceLike[] = [];
    for (let i = 0; i < 12; i++) {
      const productId = `prod_usd_${i}`;
      products.push({ id: productId, name: `USD Plan ${i}`, active: true });
      subs.push(
        subscription({
          id: `sub_usd_${i}`,
          startDate: MAR_05,
          productId,
          currency: 'usd',
          unitAmount: 1000 + i * 100,
        }),
      );
      invoices.push(
        invoice({
          id: `i_usd_${i}`,
          subscriptionId: `sub_usd_${i}`,
          finalizedAt: MAR_05,
          currency: 'usd',
          lines: [legacyLine(1000 + i * 100, { productId })],
        }),
      );
    }
    for (let i = 0; i < 12; i++) {
      const productId = `prod_cad_${i}`;
      products.push({ id: productId, name: `CAD Plan ${i}`, active: true });
      subs.push(
        subscription({
          id: `sub_cad_${i}`,
          startDate: MAR_05,
          productId,
          currency: 'cad',
          unitAmount: 5000 + i * 100,
        }),
      );
      invoices.push(
        invoice({
          id: `i_cad_${i}`,
          subscriptionId: `sub_cad_${i}`,
          finalizedAt: MAR_05,
          currency: 'cad',
          lines: [legacyLine(5000 + i * 100, { productId })],
        }),
      );
    }
    const r = growthAttribution({
      invoices,
      activeSubscriptions: subs,
      canceledSubscriptions: [],
      products,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.truncated).toBe(true);
    const otherRows = r.rows.filter((x) => x.plan_name.startsWith('Other ('));
    expect(otherRows.length).toBeGreaterThanOrEqual(1);

    // Reconciliation per currency
    const usdRowSum = r.rows
      .filter((x) => x.currency === 'usd')
      .reduce((acc, x) => acc + x.net_contribution, 0);
    const cadRowSum = r.rows
      .filter((x) => x.currency === 'cad')
      .reduce((acc, x) => acc + x.net_contribution, 0);
    expect(usdRowSum).toBeCloseTo(r.totals_by_currency.usd.net, 6);
    expect(cadRowSum).toBeCloseTo(r.totals_by_currency.cad.net, 6);

    // plan_count per currency reflects total distinct plans contributing
    expect(r.totals_by_currency.usd.plan_count).toBe(12);
    expect(r.totals_by_currency.cad.plan_count).toBe(12);
  });

  // ── coverage_starts_at forwarding ────────────────────────────────────────

  it('coverage_starts_at: forwarded from underlying event-gen', () => {
    const sub = subscription({
      id: 'sub_cov',
      startDate: MAR_15,
      productId: 'prod_pro',
    });
    const inv = invoice({
      id: 'i_cov',
      subscriptionId: 'sub_cov',
      finalizedAt: MAR_15,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const r = growthAttribution({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.coverage_starts_at).toBe('2026-03-15');
  });

  // ── Indefinite-window (Q1 2026, three months) ────────────────────────────

  it('indefinite-window: processes 3-month window without error or cap', () => {
    // 1 new in Jan (use prior-fixture MAR_05 isn't in Q1's right edge — use early Jan)
    const JAN_10 = Math.floor(Date.UTC(2026, 0, 10, 0, 0, 0) / 1000);
    const sub = subscription({
      id: 'sub_q1',
      startDate: JAN_10,
      productId: 'prod_pro',
    });
    const inv = invoice({
      id: 'i_q1',
      subscriptionId: 'sub_q1',
      finalizedAt: JAN_10,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const r = growthAttribution({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: Q1_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].net_contribution).toBe(25);
    expect(r.coverage_starts_at).toBe('2026-01-10');
  });

  // ── Expansion + contraction same plan ────────────────────────────────────

  it('expansion + contraction on same plan: both buckets populate, net cleanly reconciles', () => {
    // Sub A expands $25→$75 ($50 expansion), Sub B contracts $75→$25 ($50 contraction)
    // Same plan. Net should be zero, but both buckets populated.
    const subExp = subscription({
      id: 'sub_exp',
      startDate: 1,
      productId: 'prod_pro',
      unitAmount: 7500,        // current state amount; mrrMovement uses current sub for normalization
    });
    const subCon = subscription({
      id: 'sub_con',
      startDate: 1,
      productId: 'prod_pro',
      unitAmount: 2500,
    });
    const invoices = [
      invoice({ id: 'i_exp1', subscriptionId: 'sub_exp', finalizedAt: MAR_05, lines: [legacyLine(2500, { productId: 'prod_pro' })] }),
      invoice({ id: 'i_exp2', subscriptionId: 'sub_exp', finalizedAt: MAR_25, lines: [legacyLine(7500, { productId: 'prod_pro' })] }),
      invoice({ id: 'i_con1', subscriptionId: 'sub_con', finalizedAt: MAR_05, lines: [legacyLine(7500, { productId: 'prod_pro' })] }),
      invoice({ id: 'i_con2', subscriptionId: 'sub_con', finalizedAt: MAR_25, lines: [legacyLine(2500, { productId: 'prod_pro' })] }),
    ];
    const r = growthAttribution({
      invoices,
      activeSubscriptions: [subExp, subCon],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].plan_name).toBe('Pro Monthly');
    expect(r.rows[0].expansion_mrr).toBe(50);
    expect(r.rows[0].contraction_mrr).toBe(-50);
    expect(r.rows[0].net_contribution).toBe(0);
    expect(r.rows[0].event_count).toBe(2);
  });

  // ── Unattributed plan ────────────────────────────────────────────────────

  it('unattributed: missing products list leaves plan_name="unattributed"', () => {
    const sub = subscription({
      id: 'sub_un',
      startDate: MAR_05,
      productId: 'prod_missing',
    });
    const inv = invoice({
      id: 'i_un',
      subscriptionId: 'sub_un',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_missing' })],
    });
    const r = growthAttribution({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: [],      // no resolution available
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].plan_name).toBe('unattributed');
    expect(r.rows[0].net_contribution).toBe(25);
  });
});
