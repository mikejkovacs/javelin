// Fixture-based tests for invoice_enriched.

import { describe, it, expect } from 'vitest';
import {
  invoiceEnriched,
  type StripeInvoiceLike,
  type StripeInvoiceLineItemLike,
} from './invoiceEnriched';

const NOW = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

type LineOverrides = {
  price_id?: string;
  product?: string | { id: string } | null;
  no_price?: boolean;
};

function makeLine(o: LineOverrides = {}): StripeInvoiceLineItemLike {
  if (o.no_price) return { price: null };
  return {
    price: {
      id: o.price_id ?? 'price_test',
      product: o.product === undefined ? 'prod_test' : (o.product as string | { id: string }),
    },
  };
}

type InvoiceOverrides = {
  id?: string;
  customer?: string | null;
  status?: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  total?: number;
  subtotal?: number;
  total_excluding_tax?: number | null;
  tax?: number | null;
  amount_paid?: number;
  amount_due?: number;
  amount_remaining?: number;
  currency?: string;
  created?: number;
  finalized_at?: number | null;
  paid_at?: number | null;
  voided_at?: number | null;
  marked_uncollectible_at?: number | null;
  no_status_transitions?: boolean;
  lines?: StripeInvoiceLineItemLike[];
};

function makeInvoice(o: InvoiceOverrides = {}): StripeInvoiceLike {
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
    status_transitions: o.no_status_transitions
      ? null
      : {
          finalized_at: o.finalized_at === undefined ? NOW_SEC - 86400 : o.finalized_at,
          paid_at: o.paid_at === undefined ? NOW_SEC - 3600 : o.paid_at,
          voided_at: o.voided_at ?? null,
          marked_uncollectible_at: o.marked_uncollectible_at ?? null,
        },
    lines: { data: o.lines ?? [makeLine()] },
  };
}

describe('invoiceEnriched — money conversion', () => {
  it('converts total/subtotal/tax/amount fields to major units', () => {
    const r = invoiceEnriched({
      invoices: [makeInvoice({ total: 12345, total_excluding_tax: 11000, tax: 1345, amount_paid: 12345 })],
      now: NOW,
    });
    expect(r.rows[0].total).toBeCloseTo(123.45, 5);
    expect(r.rows[0].subtotal).toBeCloseTo(110.0, 5);
    expect(r.rows[0].tax).toBeCloseTo(13.45, 5);
    expect(r.rows[0].amount_paid).toBeCloseTo(123.45, 5);
  });

  it('zero-decimal currency (JPY)', () => {
    const r = invoiceEnriched({
      invoices: [
        makeInvoice({
          currency: 'jpy',
          total: 11000,
          total_excluding_tax: 10000,
          tax: 1000,
          amount_paid: 11000,
        }),
      ],
      now: NOW,
    });
    expect(r.rows[0].total).toBe(11000);
    expect(r.rows[0].subtotal).toBe(10000);
    expect(r.rows[0].tax).toBe(1000);
  });
});

describe('invoiceEnriched — subtotal field semantics (M2.2-S1)', () => {
  it('uses total_excluding_tax for subtotal column (post-discount, pre-tax)', () => {
    // Stripe subtotal=10000 (pre-discount), discount=2000 → total_excluding_tax=8000.
    // We surface 8000 as `subtotal` in our row, matching the def doc semantic.
    const r = invoiceEnriched({
      invoices: [
        makeInvoice({
          subtotal: 10000,
          total_excluding_tax: 8000,
          tax: 800,
          total: 8800,
        }),
      ],
      now: NOW,
    });
    expect(r.rows[0].subtotal).toBeCloseTo(80.0, 5);
    expect(r.rows[0].tax).toBeCloseTo(8.0, 5);
    expect(r.rows[0].total).toBeCloseTo(88.0, 5);
  });

  it('falls back to Stripe.subtotal when total_excluding_tax is missing', () => {
    const r = invoiceEnriched({
      invoices: [makeInvoice({ subtotal: 10000, total_excluding_tax: null })],
      now: NOW,
    });
    expect(r.rows[0].subtotal).toBeCloseTo(100.0, 5);
  });
});

describe('invoiceEnriched — line item aggregation', () => {
  it('collects unique product_ids and price_ids from line items', () => {
    const r = invoiceEnriched({
      invoices: [
        makeInvoice({
          lines: [
            makeLine({ price_id: 'price_A', product: 'prod_X' }),
            makeLine({ price_id: 'price_B', product: 'prod_Y' }),
            makeLine({ price_id: 'price_A', product: 'prod_X' }), // dup
          ],
        }),
      ],
      now: NOW,
    });
    expect(r.rows[0].price_ids.sort()).toEqual(['price_A', 'price_B']);
    expect(r.rows[0].product_ids.sort()).toEqual(['prod_X', 'prod_Y']);
  });

  it('handles expanded product object (not just string id)', () => {
    const r = invoiceEnriched({
      invoices: [
        makeInvoice({
          lines: [makeLine({ product: { id: 'prod_expanded' } })],
        }),
      ],
      now: NOW,
    });
    expect(r.rows[0].product_ids).toEqual(['prod_expanded']);
  });

  it('skips lines without a price', () => {
    const r = invoiceEnriched({
      invoices: [
        makeInvoice({
          lines: [makeLine({ no_price: true }), makeLine({ price_id: 'price_real' })],
        }),
      ],
      now: NOW,
    });
    expect(r.rows[0].price_ids).toEqual(['price_real']);
  });

  it('returns empty arrays when invoice has no line items', () => {
    const r = invoiceEnriched({
      invoices: [makeInvoice({ lines: [] })],
      now: NOW,
    });
    expect(r.rows[0].product_ids).toEqual([]);
    expect(r.rows[0].price_ids).toEqual([]);
  });

  // Schema-gap regression tests 2026-05-13 (PCL "$375 vs $371 drift investigation").
  // Dual-shape priceId/productId extraction: handles BOTH legacy line.price.*
  // and new-API line.pricing.price_details.* without falling through.
  it('dual-shape — new API line.pricing.price_details resolves to priceId + productId', () => {
    const r = invoiceEnriched({
      invoices: [
        makeInvoice({
          lines: [
            {
              amount: 10000,
              pricing: {
                price_details: {
                  price: 'price_new_shape',
                  product: 'prod_new_shape',
                },
                type: 'recurring',
              },
            } as StripeInvoiceLineItemLike,
          ],
        }),
      ],
      now: NOW,
    });
    expect(r.rows[0].price_ids).toEqual(['price_new_shape']);
    expect(r.rows[0].product_ids).toEqual(['prod_new_shape']);
  });

  it('dual-shape — mixed legacy + new shape lines in same invoice both resolve', () => {
    const r = invoiceEnriched({
      invoices: [
        makeInvoice({
          lines: [
            // Legacy shape
            {
              price: { id: 'price_legacy', product: 'prod_legacy' },
            } as StripeInvoiceLineItemLike,
            // New shape
            {
              pricing: {
                price_details: { price: 'price_new', product: 'prod_new' },
                type: 'recurring',
              },
            } as StripeInvoiceLineItemLike,
          ],
        }),
      ],
      now: NOW,
    });
    expect(r.rows[0].price_ids.sort()).toEqual(['price_legacy', 'price_new']);
    expect(r.rows[0].product_ids.sort()).toEqual(['prod_legacy', 'prod_new']);
  });
});

describe('invoiceEnriched — customer & status_transitions', () => {
  it('expands string customer id', () => {
    const r = invoiceEnriched({
      invoices: [makeInvoice({ customer: 'cus_ABC' })],
      now: NOW,
    });
    expect(r.rows[0].customer_id).toBe('cus_ABC');
  });

  it('null customer → null customer_id', () => {
    const r = invoiceEnriched({
      invoices: [makeInvoice({ customer: null })],
      now: NOW,
    });
    expect(r.rows[0].customer_id).toBeNull();
  });

  it('returns nulls for all status_transitions fields when transitions object is absent', () => {
    const r = invoiceEnriched({
      invoices: [makeInvoice({ no_status_transitions: true })],
      now: NOW,
    });
    expect(r.rows[0].finalized_at).toBeNull();
    expect(r.rows[0].paid_at).toBeNull();
    expect(r.rows[0].voided_at).toBeNull();
    expect(r.rows[0].marked_uncollectible_at).toBeNull();
  });

  it('preserves status_transitions fields from input', () => {
    const r = invoiceEnriched({
      invoices: [
        makeInvoice({
          finalized_at: NOW_SEC - 100,
          paid_at: NOW_SEC - 50,
          voided_at: NOW_SEC - 25,
          marked_uncollectible_at: NOW_SEC - 10,
        }),
      ],
      now: NOW,
    });
    expect(r.rows[0].finalized_at).toBe(NOW_SEC - 100);
    expect(r.rows[0].paid_at).toBe(NOW_SEC - 50);
    expect(r.rows[0].voided_at).toBe(NOW_SEC - 25);
    expect(r.rows[0].marked_uncollectible_at).toBe(NOW_SEC - 10);
  });
});

describe('invoiceEnriched — output envelope', () => {
  it('empty invoices → empty rows', () => {
    const r = invoiceEnriched({ invoices: [], now: NOW });
    expect(r.rows).toEqual([]);
    expect(r.kind).toBe('rows');
  });

  it('sets definition and as_of', () => {
    const r = invoiceEnriched({ invoices: [makeInvoice()], now: NOW });
    expect(r.definition).toBe('javelin.invoice_enriched.v1');
    expect(r.as_of).toBe(NOW_SEC);
  });

  it('preserves row order from input', () => {
    const r = invoiceEnriched({
      invoices: [
        makeInvoice({ id: 'in_1' }),
        makeInvoice({ id: 'in_2' }),
        makeInvoice({ id: 'in_3' }),
      ],
      now: NOW,
    });
    expect(r.rows.map((r) => r.invoice_id)).toEqual(['in_1', 'in_2', 'in_3']);
  });
});
