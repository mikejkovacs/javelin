import { describe, it, expect } from 'vitest';
import { mrrMovement, type StripeCustomerLike } from './mrrMovement';
import type { StripeInvoiceLike, StripeInvoiceLineItemLike } from './invoiceEnriched';
import type { StripeSubscriptionLike } from './subscriptionEnriched';
import type { StripeProductLike } from './revenueByPlan';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const FEB_05 = Math.floor(Date.UTC(2026, 1, 5, 0, 0, 0) / 1000);
const FEB_15 = Math.floor(Date.UTC(2026, 1, 15, 0, 0, 0) / 1000);
const MAR_05 = Math.floor(Date.UTC(2026, 2, 5, 0, 0, 0) / 1000);
const MAR_15 = Math.floor(Date.UTC(2026, 2, 15, 0, 0, 0) / 1000);
const MAR_25 = Math.floor(Date.UTC(2026, 2, 25, 0, 0, 0) / 1000);
const APR_05 = Math.floor(Date.UTC(2026, 3, 5, 0, 0, 0) / 1000);
const APR_15 = Math.floor(Date.UTC(2026, 3, 15, 0, 0, 0) / 1000);
const APR_28 = Math.floor(Date.UTC(2026, 3, 28, 0, 0, 0) / 1000);

const MARCH_2026 = {
  start: Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};

const APRIL_2026 = {
  start: Math.floor(Date.UTC(2026, 3, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 3, 30, 23, 59, 59) / 1000),
};

const Q1_2026 = {
  start: Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};

// ── Builders ──────────────────────────────────────────────────────────────

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

function newShapeLine(
  amount: number,
  productId: string,
  type: 'recurring' | 'one_time' = 'recurring',
): StripeInvoiceLineItemLike {
  return {
    amount,
    pricing: {
      price_details: { price: 'price_new_x', product: productId },
      type,
    },
  };
}

function invoice(opts: {
  id: string;
  subscriptionId: string;
  status?: 'paid' | 'open' | 'uncollectible' | 'void' | 'draft';
  finalizedAt: number;
  currency?: string;
  lines: StripeInvoiceLineItemLike[];
}): StripeInvoiceLike {
  return {
    id: opts.id,
    customer: 'cus_x',
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
    // Embed subscription as a legacy-shape field. The primitive's defensive
    // reader handles both legacy and new shape; tests focus on the legacy path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ subscription: opts.subscriptionId } as any),
  };
}

function newShapeInvoice(opts: {
  id: string;
  subscriptionId: string;
  finalizedAt: number;
  currency?: string;
  lines: StripeInvoiceLineItemLike[];
}): StripeInvoiceLike {
  // No top-level invoice.subscription — uses new-shape parent.subscription_details
  const base = invoice({ ...opts, status: 'paid' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withoutSub = base as any;
  delete withoutSub.subscription;
  withoutSub.parent = { subscription_details: { subscription: opts.subscriptionId } };
  return base;
}

function subscription(opts: {
  id: string;
  customerId?: string;
  startDate: number;
  endedAt?: number | null;
  status?: string;
  interval?: 'day' | 'week' | 'month' | 'year';
  interval_count?: number;
  unitAmount?: number;
  currency?: string;
  productId?: string;
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
              interval: opts.interval ?? 'month',
              interval_count: opts.interval_count ?? 1,
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
];

const CUSTOMERS: StripeCustomerLike[] = [
  { id: 'cus_acme', name: 'Acme Corp', email: 'ops@acme.com' },
  { id: 'cus_beta', name: 'Beta Industries', email: 'beta@example.com' },
  { id: 'cus_solo', name: null, email: 'solo@example.com' },
];

describe('mrrMovement', () => {
  // ── New bucket ────────────────────────────────────────────────────────

  it('new: subscription created in period with first invoice in period emits new event', () => {
    const sub = subscription({
      id: 'sub_advice_1',
      customerId: 'cus_acme',
      startDate: MAR_05,
    });
    const inv = invoice({
      id: 'in_1',
      subscriptionId: 'sub_advice_1',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_advice_access' })],
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('new');
    expect(r.events[0].plan_name).toBe('Advice Access');
    expect(r.events[0].customer_display_name).toBe('Acme Corp');
    expect(r.events[0].amount).toBe(25);
    expect(r.totals_by_currency.usd.new).toBe(25);
    expect(r.totals_by_currency.usd.net).toBe(25);
  });

  it('new: respects first-bill latency (sub created but no invoice yet) — no event emitted', () => {
    const sub = subscription({
      id: 'sub_advice_2',
      startDate: MAR_25,
    });
    const r = mrrMovement({
      invoices: [],                       // no invoices yet
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(0);
    expect(r.totals_by_currency).toEqual({});
  });

  it('new: sub created prior month with first invoice this month fires new in this month', () => {
    // Subscription created March 25 (prior period), first invoice April 5
    // (current period). The "new" event fires in April (when MRR actually
    // started flowing), not March. This handles cross-period first-bill latency.
    const sub = subscription({
      id: 'sub_late_bill',
      startDate: MAR_25,
    });
    const inv = invoice({
      id: 'in_late_bill_apr',
      subscriptionId: 'sub_late_bill',
      finalizedAt: APR_05,
      lines: [legacyLine(2500, { productId: 'prod_advice_access' })],
    });
    // Ask about April: should emit new event
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: APRIL_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('new');
    expect(r.events[0].date).toBe(APR_05);            // dated at first invoice, not sub start
    expect(r.events[0].amount).toBe(25);
  });

  it('new: older sub does NOT fire new when its first FETCHED invoice falls in period', () => {
    // Sub created Aug 2025 — long before fetched invoice window. The
    // "first" invoice we see is March 2026 (mid-life billing). Must NOT
    // fire a spurious new event.
    const subOld = subscription({
      id: 'sub_old',
      startDate: Math.floor(Date.UTC(2025, 7, 1, 0, 0, 0) / 1000),  // Aug 1 2025
    });
    const inv = invoice({
      id: 'in_mid_life',
      subscriptionId: 'sub_old',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_advice_access' })],
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [subOld],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(0);                  // skipped per latency guard
  });

  it('new: subscription created OUTSIDE period excluded', () => {
    const sub = subscription({ id: 'sub_old', startDate: FEB_05 });
    const inv = invoice({
      id: 'in_old',
      subscriptionId: 'sub_old',
      finalizedAt: FEB_05,
      lines: [legacyLine(2500, { productId: 'prod_advice_access' })],
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(0);
  });

  it('new: trial-to-paid fires NEW at conversion invoice, not trial-create $0 invoice', () => {
    // Limitation #6: sub created Mar 5 with short trial, $0 subscription_create
    // invoice on Mar 5, first paid (subscription_cycle) invoice on Mar 15. NEW
    // event should fire for Mar 15 with the paid amount — not be skipped due
    // to leading $0 invoice. Pre-fix, monthlyAmount=0 on subInvoices[0] caused
    // the entire sub to be dropped, contradicting documented limitation #6.
    const sub = subscription({ id: 'sub_trial', startDate: MAR_05 });
    const trialCreate = invoice({
      id: 'in_trial_create',
      subscriptionId: 'sub_trial',
      finalizedAt: MAR_05,
      lines: [legacyLine(0, { productId: 'prod_advice_access' })],
    });
    const firstPaid = invoice({
      id: 'in_first_paid',
      subscriptionId: 'sub_trial',
      finalizedAt: MAR_15,
      lines: [legacyLine(2500, { productId: 'prod_advice_access' })],
    });
    const r = mrrMovement({
      invoices: [trialCreate, firstPaid],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    const newEvents = r.events.filter((e) => e.bucket_type === 'new');
    expect(newEvents).toHaveLength(1);
    expect(newEvents[0].date).toBe(MAR_15);          // dated at conversion, not trial start
    expect(newEvents[0].amount).toBe(25);
    expect(r.totals_by_currency.usd.new).toBe(25);
  });

  it('new: pause-resumed older sub does NOT fire spurious NEW when $0 streak transitions to paying', () => {
    // Sub started months ago (FEB_05 — outside latency window), had a $0
    // paused invoice early in March, then resumed paying mid-March. The
    // first-paid-invoice scan in Pass 1 picks the Mar 15 paying invoice, but
    // the 35-day latency check from sub.start_date (FEB_05) must reject it
    // as not a genuine new sub. Otherwise we'd double-count: false NEW +
    // expansion-pass would also see the $0→$25 jump.
    const sub = subscription({ id: 'sub_resumed', startDate: FEB_05 });
    const pausedZero = invoice({
      id: 'in_paused',
      subscriptionId: 'sub_resumed',
      finalizedAt: MAR_05,
      lines: [legacyLine(0, { productId: 'prod_pro' })],
    });
    const resume = invoice({
      id: 'in_resume',
      subscriptionId: 'sub_resumed',
      finalizedAt: MAR_15,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const r = mrrMovement({
      invoices: [pausedZero, resume],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    const newEvents = r.events.filter((e) => e.bucket_type === 'new');
    expect(newEvents).toHaveLength(0);
  });

  // ── Churned bucket ────────────────────────────────────────────────────

  it('churned: subscription with ended_at in period emits churned event with sign-flipped amount', () => {
    const sub = subscription({
      id: 'sub_churn',
      customerId: 'cus_beta',
      startDate: FEB_05,
      endedAt: MAR_25,
    });
    // Last paid invoice before cancellation
    const inv = invoice({
      id: 'in_last',
      subscriptionId: 'sub_churn',
      finalizedAt: FEB_05,
      lines: [legacyLine(5000, { productId: 'prod_pro' })],
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [],
      canceledSubscriptions: [sub],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('churned');
    expect(r.events[0].plan_name).toBe('Pro Monthly');
    expect(r.events[0].amount).toBe(-50);
    expect(r.events[0].customer_display_name).toBe('Beta Industries');
    expect(r.totals_by_currency.usd.churned).toBe(-50);
    expect(r.totals_by_currency.usd.net).toBe(-50);
  });

  it('churned: annual sub canceled with no invoice in fetch falls back to sub.items', () => {
    // Limitation #9 / Bug B fix: annual sub started a year ago, canceled in
    // March 2026. Last invoice is ~12 months out — outside the invoice-fetch
    // 30-day widening, so invoicesBySub is empty for this sub. Without the
    // sub.items fallback, churn would silently drop. With it, MRR loss
    // computes from sub.items: $120/year = $10/month.
    const oneYearAgo = Math.floor(Date.UTC(2025, 2, 1, 0, 0, 0) / 1000);
    const annualSub = subscription({
      id: 'sub_annual_churn',
      customerId: 'cus_acme',
      startDate: oneYearAgo,
      endedAt: MAR_15,
      interval: 'year',
      unitAmount: 12000,                       // $120/year
      productId: 'prod_pro',
    });
    const r = mrrMovement({
      invoices: [],                             // no invoices in fetch window
      activeSubscriptions: [],
      canceledSubscriptions: [annualSub],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('churned');
    expect(r.events[0].amount).toBe(-10);    // $120/yr ÷ 12 = $10/mo
    expect(r.events[0].plan_name).toBe('Pro Monthly');
    expect(r.events[0].customer_display_name).toBe('Acme Corp');
    expect(r.totals_by_currency.usd.churned).toBe(-10);
  });

  it('churned: quarterly sub with no invoice in fetch falls back to sub.items', () => {
    const oneYearAgo = Math.floor(Date.UTC(2025, 2, 1, 0, 0, 0) / 1000);
    const quarterlySub = subscription({
      id: 'sub_quarterly_churn',
      startDate: oneYearAgo,
      endedAt: MAR_15,
      interval: 'month',
      interval_count: 3,                       // billed every 3 months
      unitAmount: 9000,                        // $90/quarter
      productId: 'prod_starter',
    });
    const r = mrrMovement({
      invoices: [],
      activeSubscriptions: [],
      canceledSubscriptions: [quarterlySub],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('churned');
    expect(r.events[0].amount).toBe(-30);    // $90/quarter ÷ 3 = $30/mo
    expect(r.events[0].plan_name).toBe('Starter');
  });

  it('churned: sub created and canceled within period with no invoice does NOT fire (avoids false positive)', () => {
    // Edge case: sub created Mar 5, canceled Mar 25, no invoice ever fired
    // (canceled before billing cycle completed). Sub started <35 days before
    // period.start, so the sub-items fallback should NOT fire — we'd be
    // counting MRR loss for a sub that never contributed MRR.
    const recentSub = subscription({
      id: 'sub_quick_cancel',
      startDate: MAR_05,
      endedAt: MAR_25,
      unitAmount: 5000,
    });
    const r = mrrMovement({
      invoices: [],
      activeSubscriptions: [],
      canceledSubscriptions: [recentSub],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(0);
  });

  it('churned: monthly sub with last invoice in fetch still uses invoice path (no regression)', () => {
    // The fallback should only fire when invoicesBySub is empty. When an
    // invoice exists (the common monthly case), preserve existing behavior so
    // discount-applied amounts remain accurate.
    const sub = subscription({
      id: 'sub_monthly_churn',
      startDate: FEB_05,
      endedAt: MAR_25,
      unitAmount: 9999,                        // would give a different amount via items
      productId: 'prod_pro',
    });
    const inv = invoice({
      id: 'in_last_paid',
      subscriptionId: 'sub_monthly_churn',
      finalizedAt: FEB_15,
      lines: [legacyLine(5000, { productId: 'prod_pro' })],   // invoice says $50
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [],
      canceledSubscriptions: [sub],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].amount).toBe(-50);    // invoice path, not items ($99.99)
  });

  it('churned: annual sub fallback respects sub currency (multi-currency)', () => {
    const oneYearAgo = Math.floor(Date.UTC(2025, 2, 1, 0, 0, 0) / 1000);
    const eurAnnual = subscription({
      id: 'sub_eur_annual',
      startDate: oneYearAgo,
      endedAt: MAR_15,
      interval: 'year',
      unitAmount: 12000,
      currency: 'eur',
      productId: 'prod_pro',
    });
    const r = mrrMovement({
      invoices: [],
      activeSubscriptions: [],
      canceledSubscriptions: [eurAnnual],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].currency).toBe('eur');
    expect(r.events[0].amount).toBe(-10);
    expect(r.totals_by_currency.eur.churned).toBe(-10);
    expect(r.totals_by_currency.usd).toBeUndefined();
  });

  // ── Expansion / Contraction buckets ───────────────────────────────────

  it('expansion: consecutive invoices showing amount increase emit expansion event with delta', () => {
    const sub = subscription({
      id: 'sub_grow',
      customerId: 'cus_acme',
      startDate: FEB_05,
    });
    const invFeb = invoice({
      id: 'in_feb',
      subscriptionId: 'sub_grow',
      finalizedAt: FEB_05,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const invMar = invoice({
      id: 'in_mar',
      subscriptionId: 'sub_grow',
      finalizedAt: MAR_05,
      lines: [legacyLine(5000, { productId: 'prod_pro' })],     // upgrade
    });
    const r = mrrMovement({
      invoices: [invFeb, invMar],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('expansion');
    expect(r.events[0].amount).toBe(25);                    // $50 - $25 = +$25
    expect(r.events[0].prior_amount).toBe(25);
    expect(r.events[0].date).toBe(MAR_05);
    expect(r.totals_by_currency.usd.expansion).toBe(25);
  });

  it('contraction: consecutive invoices showing amount decrease emit contraction with signed delta', () => {
    const sub = subscription({ id: 'sub_shrink', startDate: FEB_05 });
    const invFeb = invoice({
      id: 'in_feb',
      subscriptionId: 'sub_shrink',
      finalizedAt: FEB_05,
      lines: [legacyLine(5000, { productId: 'prod_pro' })],
    });
    const invMar = invoice({
      id: 'in_mar',
      subscriptionId: 'sub_shrink',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],     // downgrade
    });
    const r = mrrMovement({
      invoices: [invFeb, invMar],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('contraction');
    expect(r.events[0].amount).toBe(-25);
    expect(r.totals_by_currency.usd.contraction).toBe(-25);
  });

  it('flat consecutive invoices emit NO movement event', () => {
    const sub = subscription({ id: 'sub_flat', startDate: FEB_05 });
    const invFeb = invoice({
      id: 'in_feb',
      subscriptionId: 'sub_flat',
      finalizedAt: FEB_05,
      lines: [legacyLine(2500, { productId: 'prod_advice_access' })],
    });
    const invMar = invoice({
      id: 'in_mar',
      subscriptionId: 'sub_flat',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_advice_access' })],
    });
    const r = mrrMovement({
      invoices: [invFeb, invMar],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(0);
  });

  // ── Annual interval normalization ──────────────────────────────────────

  it('annual subscription: invoice amount normalized to monthly via interval factor', () => {
    const sub = subscription({
      id: 'sub_annual',
      startDate: MAR_05,
      interval: 'year',
    });
    const inv = invoice({
      id: 'in_annual',
      subscriptionId: 'sub_annual',
      finalizedAt: MAR_05,
      lines: [legacyLine(30000, { productId: 'prod_pro' })], // $300/year
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('new');
    // $300/year ÷ 12 = $25/month
    expect(r.events[0].amount).toBe(25);
  });

  // ── Multi-currency ────────────────────────────────────────────────────

  it('multi-currency: separate rows per currency, no cross-currency sum', () => {
    const subUsd = subscription({ id: 'sub_us', startDate: MAR_05 });
    const subCad = subscription({ id: 'sub_ca', startDate: MAR_15 });
    const invUsd = invoice({
      id: 'in_us',
      subscriptionId: 'sub_us',
      finalizedAt: MAR_05,
      currency: 'usd',
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const invCad = invoice({
      id: 'in_ca',
      subscriptionId: 'sub_ca',
      finalizedAt: MAR_15,
      currency: 'cad',
      lines: [legacyLine(5000, { productId: 'prod_pro' })],
    });
    const r = mrrMovement({
      invoices: [invUsd, invCad],
      activeSubscriptions: [subUsd, subCad],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(2);
    expect(r.totals_by_currency.usd.new).toBe(25);
    expect(r.totals_by_currency.cad.new).toBe(50);
    // Rows: 2 (one per currency)
    expect(r.rows.filter((row) => row.bucket === 'new')).toHaveLength(2);
  });

  // ── New API shape ──────────────────────────────────────────────────────

  it('new API shape: invoice.parent.subscription_details.subscription resolves correctly', () => {
    const sub = subscription({
      id: 'sub_new_shape',
      customerId: 'cus_solo',
      startDate: MAR_05,
    });
    const inv = newShapeInvoice({
      id: 'in_new',
      subscriptionId: 'sub_new_shape',
      finalizedAt: MAR_05,
      lines: [newShapeLine(2500, 'prod_advice_access')],
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('new');
    expect(r.events[0].plan_name).toBe('Advice Access');
    expect(r.events[0].amount).toBe(25);
    // customer name resolution should still work even when email is preferred
    expect(r.events[0].customer_display_name).toBe('solo@example.com');
  });

  // ── Proration / one_time lines filtered ────────────────────────────────

  it('one-time / proration lines are excluded from MRR computation', () => {
    const sub = subscription({ id: 'sub_proration', startDate: FEB_05 });
    const invFeb = invoice({
      id: 'in_feb',
      subscriptionId: 'sub_proration',
      finalizedAt: FEB_05,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    // March invoice has a proration line + recurring line. Only the recurring
    // line should count toward MRR.
    const invMar = invoice({
      id: 'in_mar',
      subscriptionId: 'sub_proration',
      finalizedAt: MAR_05,
      lines: [
        newShapeLine(1500, 'prod_pro', 'one_time'),       // proration credit/charge
        legacyLine(5000, { productId: 'prod_pro' }),       // post-upgrade recurring
      ],
    });
    const r = mrrMovement({
      invoices: [invFeb, invMar],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('expansion');
    expect(r.events[0].amount).toBe(25);                  // $50-$25, prorating line dropped
  });

  // ── Status filtering ───────────────────────────────────────────────────

  it('excludes voided invoices from movement detection', () => {
    const sub = subscription({ id: 'sub_x', startDate: MAR_05 });
    const inv = invoice({
      id: 'in_void',
      subscriptionId: 'sub_x',
      finalizedAt: MAR_05,
      status: 'void',
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(0);
  });

  // ── Event detail cap + truncated flag ──────────────────────────────────

  it('caps per-event detail at top 50 by absolute amount and sets truncated flag', () => {
    // Build 55 subs creating in period → 55 new events.
    const subs: StripeSubscriptionLike[] = [];
    const invs: StripeInvoiceLike[] = [];
    for (let i = 0; i < 55; i++) {
      const subId = `sub_${i}`;
      subs.push(subscription({ id: subId, startDate: MAR_05 }));
      // Different amounts to verify sort by |amount| desc — first sub has
      // smallest amount, last sub has largest, after sort, last should win.
      invs.push(
        invoice({
          id: `in_${i}`,
          subscriptionId: subId,
          finalizedAt: MAR_05,
          lines: [legacyLine(2500 + i * 100, { productId: 'prod_pro' })],
        }),
      );
    }
    const r = mrrMovement({
      invoices: invs,
      activeSubscriptions: subs,
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(50);                   // capped at top 50
    expect(r.truncated).toBe(true);
    // Top event should have the largest amount
    expect(r.events[0].amount).toBeGreaterThan(r.events[49].amount);
    // Bucket totals reflect ALL 55 events (not just the capped 50)
    expect(r.rows[0].event_count).toBe(55);
  });

  // ── Coverage starts_at signal ──────────────────────────────────────────

  it('coverage_starts_at: earliest in-period invoice ISO date', () => {
    const sub = subscription({ id: 'sub_a', startDate: MAR_15 });
    const inv = invoice({
      id: 'in_a',
      subscriptionId: 'sub_a',
      finalizedAt: MAR_15,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.coverage_starts_at).toBe('2026-03-15');
  });

  it('coverage_starts_at: null when no in-period invoices', () => {
    const r = mrrMovement({
      invoices: [],
      activeSubscriptions: [],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.coverage_starts_at).toBe(null);
  });

  // ── Envelope ──────────────────────────────────────────────────────────

  it('output envelope: definition, period, as_of, metric_type=flow', () => {
    const r = mrrMovement({
      invoices: [],
      activeSubscriptions: [],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.kind).toBe('rows');
    expect(r.metric_type).toBe('flow');
    expect(r.definition).toBe('javelin_defined.mrr_movement');
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.period).toEqual(MARCH_2026);
    expect(r.truncated).toBe(false);
    expect(r.totals_by_currency).toEqual({});
  });

  // ── Q1=A: reactivation collapses into new ─────────────────────────────

  it('reactivation collapses into new (each new sub gets new bucket per Q1=A)', () => {
    // Customer cus_acme has a canceled sub from Feb, and a NEW sub created in March
    const subCanceled = subscription({
      id: 'sub_old',
      customerId: 'cus_acme',
      startDate: FEB_05,
      endedAt: FEB_15,
    });
    const subNew = subscription({
      id: 'sub_new',
      customerId: 'cus_acme',
      startDate: MAR_05,
    });
    const invOld = invoice({
      id: 'in_old',
      subscriptionId: 'sub_old',
      finalizedAt: FEB_05,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const invNew = invoice({
      id: 'in_new',
      subscriptionId: 'sub_new',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const r = mrrMovement({
      invoices: [invOld, invNew],
      activeSubscriptions: [subNew],
      canceledSubscriptions: [subCanceled],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    // March period emits ONE new event (for the new sub) — the old churned
    // event is from February (outside period) so it doesn't fire here either.
    expect(r.events).toHaveLength(1);
    expect(r.events[0].bucket_type).toBe('new');
    expect(r.events[0].subscription_id).toBe('sub_new');
  });

  // ── Bucket totals + rows shape ─────────────────────────────────────────

  it('bucket totals sum events correctly within currency', () => {
    // 2 new events ($25 + $50 = $75) + 1 expansion ($25) + 1 churned (-$50)
    // Net = 75 + 25 - 50 = $50
    const subA = subscription({ id: 'sub_a', startDate: MAR_05 });
    const subB = subscription({ id: 'sub_b', startDate: MAR_15 });
    const subGrow = subscription({ id: 'sub_grow', startDate: FEB_05 });
    const subChurn = subscription({
      id: 'sub_churn',
      startDate: FEB_05,
      endedAt: MAR_25,
    });
    const invs = [
      invoice({
        id: 'in_a',
        subscriptionId: 'sub_a',
        finalizedAt: MAR_05,
        lines: [legacyLine(2500, { productId: 'prod_pro' })],
      }),
      invoice({
        id: 'in_b',
        subscriptionId: 'sub_b',
        finalizedAt: MAR_15,
        lines: [legacyLine(5000, { productId: 'prod_pro' })],
      }),
      invoice({
        id: 'in_grow_feb',
        subscriptionId: 'sub_grow',
        finalizedAt: FEB_05,
        lines: [legacyLine(2500, { productId: 'prod_pro' })],
      }),
      invoice({
        id: 'in_grow_mar',
        subscriptionId: 'sub_grow',
        finalizedAt: MAR_05,
        lines: [legacyLine(5000, { productId: 'prod_pro' })],
      }),
      invoice({
        id: 'in_churn',
        subscriptionId: 'sub_churn',
        finalizedAt: FEB_05,
        lines: [legacyLine(5000, { productId: 'prod_pro' })],
      }),
    ];
    const r = mrrMovement({
      invoices: invs,
      activeSubscriptions: [subA, subB, subGrow],
      canceledSubscriptions: [subChurn],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.totals_by_currency.usd.new).toBe(75);
    expect(r.totals_by_currency.usd.expansion).toBe(25);
    expect(r.totals_by_currency.usd.contraction).toBe(0);
    expect(r.totals_by_currency.usd.churned).toBe(-50);
    expect(r.totals_by_currency.usd.net).toBe(50);
    // Should have 4 rows (new + expansion + churned for usd; contraction missing because no events)
    expect(r.rows).toHaveLength(3);
  });

  // ── Empty period ───────────────────────────────────────────────────────

  it('empty period: empty events, empty totals, empty rows', () => {
    const r = mrrMovement({
      invoices: [],
      activeSubscriptions: [],
      canceledSubscriptions: [],
      products: PRODUCTS,
      period: APRIL_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(0);
    expect(r.rows).toHaveLength(0);
    expect(r.totals_by_currency).toEqual({});
    expect(r.coverage_starts_at).toBe(null);
  });

  // ── Long window beyond 30 days (F1's indefinite-window advantage) ──────

  it('Q1 2026 window: events emitted across multiple months (no 30-day cap)', () => {
    const subAcme = subscription({
      id: 'sub_acme',
      customerId: 'cus_acme',
      startDate: FEB_05,
    });
    const invs = [
      invoice({
        id: 'in_feb',
        subscriptionId: 'sub_acme',
        finalizedAt: FEB_05,
        lines: [legacyLine(2500, { productId: 'prod_pro' })],
      }),
      invoice({
        id: 'in_mar',
        subscriptionId: 'sub_acme',
        finalizedAt: MAR_05,
        lines: [legacyLine(5000, { productId: 'prod_pro' })],         // upgrade
      }),
    ];
    const r = mrrMovement({
      invoices: invs,
      activeSubscriptions: [subAcme],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: Q1_2026,
      now: NOW,
    });
    expect(r.events).toHaveLength(2);                       // new in Feb + expansion in Mar
    const newEvent = r.events.find((e) => e.bucket_type === 'new');
    const expEvent = r.events.find((e) => e.bucket_type === 'expansion');
    expect(newEvent?.date_iso).toBe('2026-02-05');
    expect(expEvent?.date_iso).toBe('2026-03-05');
    expect(r.totals_by_currency.usd.new).toBe(25);
    expect(r.totals_by_currency.usd.expansion).toBe(25);
    expect(r.totals_by_currency.usd.net).toBe(50);
  });

  // ── Customer display name fallback ─────────────────────────────────────

  it('customer display name: falls back to email when name is null', () => {
    const sub = subscription({
      id: 'sub_solo',
      customerId: 'cus_solo',
      startDate: MAR_05,
    });
    const inv = invoice({
      id: 'in_solo',
      subscriptionId: 'sub_solo',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events[0].customer_display_name).toBe('solo@example.com');
  });

  it('customer display name: "Unknown customer" when customer not in map', () => {
    const sub = subscription({
      id: 'sub_x',
      customerId: 'cus_missing',
      startDate: MAR_05,
    });
    const inv = invoice({
      id: 'in_x',
      subscriptionId: 'sub_x',
      finalizedAt: MAR_05,
      lines: [legacyLine(2500, { productId: 'prod_pro' })],
    });
    const r = mrrMovement({
      invoices: [inv],
      activeSubscriptions: [sub],
      canceledSubscriptions: [],
      products: PRODUCTS,
      customers: CUSTOMERS,
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.events[0].customer_display_name).toBe('Unknown customer');
  });
});
