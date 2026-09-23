import { describe, it, expect } from 'vitest';
import {
  periodBilledRevenue,
  periodBilledRevenueInclusiveOfTax,
} from './periodBilledRevenue';
import type { StripeInvoiceLike } from './invoiceEnriched';

const NOW = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const PERIOD = { start: NOW_SEC - 86400 * 30, end: NOW_SEC };

function makeInvoice(o: Partial<StripeInvoiceLike> & {
  finalized_at?: number | null;
  paid_at?: number | null;
} = {}): StripeInvoiceLike {
  return {
    id: o.id ?? 'in_test',
    customer: o.customer === undefined ? 'cus_test' : o.customer,
    status: o.status ?? 'paid',
    total: o.total ?? 11000,
    subtotal: o.subtotal ?? 10000,
    total_excluding_tax: o.total_excluding_tax === undefined ? 10000 : o.total_excluding_tax,
    tax: o.tax === undefined ? 1000 : o.tax,
    amount_paid: o.amount_paid ?? 11000,
    amount_due: o.amount_due ?? 0,
    amount_remaining: o.amount_remaining ?? 0,
    currency: o.currency ?? 'usd',
    created: o.created ?? NOW_SEC - 86400,
    status_transitions: {
      finalized_at: o.finalized_at === undefined ? NOW_SEC - 86400 : o.finalized_at,
      paid_at: o.paid_at === undefined ? NOW_SEC - 3600 : o.paid_at,
      voided_at: null,
      marked_uncollectible_at: null,
    },
    lines: o.lines ?? { data: [] },
  };
}

describe('periodBilledRevenue (subtotal basis)', () => {
  it('empty input → empty rows', () => {
    const r = periodBilledRevenue({ invoices: [], period: PERIOD, now: NOW });
    expect(r.rows).toEqual([]);
  });

  it('sums subtotal (post-discount, pre-tax) for paid + open + uncollectible', () => {
    const r = periodBilledRevenue({
      invoices: [
        makeInvoice({ id: 'i1', status: 'paid', total_excluding_tax: 10000 }),
        makeInvoice({ id: 'i2', status: 'open', total_excluding_tax: 5000 }),
        makeInvoice({ id: 'i3', status: 'uncollectible', total_excluding_tax: 2500 }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].billed_revenue).toBeCloseTo(175.0, 5);
    expect(r.rows[0].invoice_count).toBe(3);
    expect(r.basis).toBe('subtotal');
  });

  it('excludes voided and draft invoices', () => {
    const r = periodBilledRevenue({
      invoices: [
        makeInvoice({ id: 'i1', status: 'paid', total_excluding_tax: 10000 }),
        makeInvoice({ id: 'i2', status: 'void', total_excluding_tax: 5000 }),
        makeInvoice({ id: 'i3', status: 'draft', total_excluding_tax: 3000, finalized_at: null }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].billed_revenue).toBeCloseTo(100.0, 5);
    expect(r.rows[0].invoice_count).toBe(1);
  });

  it('filters by finalized_at, NOT created_at (M2.2-S3 widening)', () => {
    // Invoice created 60 days ago (outside period via created), but finalized
    // INSIDE the period — must be included.
    const r = periodBilledRevenue({
      invoices: [
        makeInvoice({
          id: 'late_finalize',
          total_excluding_tax: 10000,
          created: PERIOD.start - 86400 * 60,
          finalized_at: PERIOD.start + 86400, // finalized inside the period
        }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].billed_revenue).toBeCloseTo(100.0, 5);
  });

  it('excludes invoices finalized outside the period', () => {
    const r = periodBilledRevenue({
      invoices: [
        makeInvoice({ id: 'before', total_excluding_tax: 10000, finalized_at: PERIOD.start - 1 }),
        makeInvoice({ id: 'after', total_excluding_tax: 5000, finalized_at: PERIOD.end + 1 }),
        makeInvoice({ id: 'in', total_excluding_tax: 2500, finalized_at: NOW_SEC - 86400 }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].billed_revenue).toBeCloseTo(25.0, 5);
    expect(r.rows[0].invoice_count).toBe(1);
  });

  it('excludes invoices with no finalized_at (drafts)', () => {
    const r = periodBilledRevenue({
      invoices: [
        makeInvoice({
          id: 'never_finalized',
          status: 'paid',
          total_excluding_tax: 10000,
          finalized_at: null,
        }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows).toEqual([]);
  });

  it('groups by currency, sorted alphabetically', () => {
    const r = periodBilledRevenue({
      invoices: [
        makeInvoice({ id: 'i1', currency: 'usd', total_excluding_tax: 10000 }),
        makeInvoice({ id: 'i2', currency: 'eur', total_excluding_tax: 5000 }),
        makeInvoice({ id: 'i3', currency: 'jpy', total_excluding_tax: 1000 }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows.map((r) => r.currency)).toEqual(['eur', 'jpy', 'usd']);
  });

  it('envelope: definition + period + basis + kind', () => {
    const r = periodBilledRevenue({
      invoices: [makeInvoice()],
      period: PERIOD,
      now: NOW,
    });
    expect(r.kind).toBe('rows');
    expect(r.definition).toBe('stripe_revenue_recognition.period_billed_revenue');
    expect(r.basis).toBe('subtotal');
    expect(r.period).toEqual(PERIOD);
    expect(r.as_of).toBe(NOW_SEC);
  });
});

describe('periodBilledRevenueInclusiveOfTax (total basis)', () => {
  it('sums total (post-discount + tax) instead of subtotal', () => {
    const r = periodBilledRevenueInclusiveOfTax({
      invoices: [
        makeInvoice({ id: 'i1', total_excluding_tax: 10000, tax: 1000, total: 11000 }),
        makeInvoice({ id: 'i2', total_excluding_tax: 5000, tax: 500, total: 5500 }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].billed_revenue).toBeCloseTo(165.0, 5);
    expect(r.basis).toBe('total');
  });

  it('envelope reflects inclusive-of-tax definition', () => {
    const r = periodBilledRevenueInclusiveOfTax({
      invoices: [makeInvoice()],
      period: PERIOD,
      now: NOW,
    });
    expect(r.definition).toBe('stripe_revenue_recognition.period_billed_revenue_inclusive_of_tax');
  });
});
