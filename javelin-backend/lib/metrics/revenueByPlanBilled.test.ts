import { describe, it, expect } from 'vitest';
import { revenueByPlanBilled } from './revenueByPlanBilled';
import type {
  StripeInvoiceLike,
  StripeInvoiceLineItemLike,
} from './invoiceEnriched';
import type { StripeProductLike } from './revenueByPlan';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const MARCH_2026 = {
  start: Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};

const MAR_05 = Math.floor(Date.UTC(2026, 2, 5, 0, 0, 0) / 1000);
const MAR_15 = Math.floor(Date.UTC(2026, 2, 15, 0, 0, 0) / 1000);
const MAR_25 = Math.floor(Date.UTC(2026, 2, 25, 0, 0, 0) / 1000);
const APR_10 = Math.floor(Date.UTC(2026, 3, 10, 0, 0, 0) / 1000);

/** Builds a legacy-shape line — uses `line.price.*`. Matches FIXTURE_INVOICES. */
function legacyLine(opts: {
  amount: number;
  nickname?: string | null;
  productId?: string;
  productName?: string | null;
  priceId?: string;
}): StripeInvoiceLineItemLike {
  return {
    amount: opts.amount,
    price: {
      id: opts.priceId ?? 'price_x',
      product:
        opts.productName !== undefined
          ? { id: opts.productId ?? 'prod_x', name: opts.productName }
          : opts.productId ?? 'prod_x',
      nickname: opts.nickname ?? null,
    },
  };
}

/** Builds a NEW-shape line — uses `line.pricing.price_details.*`. Mirrors
 *  production data on Stripe's 2024-2025 API restructure. */
function newShapeLine(opts: {
  amount: number;
  productId: string;
  priceId?: string;
  type?: 'recurring' | 'one_time';
}): StripeInvoiceLineItemLike {
  return {
    amount: opts.amount,
    pricing: {
      price_details: {
        price: opts.priceId ?? 'price_new_x',
        product: opts.productId,
      },
      type: opts.type ?? 'recurring',
      unit_amount_decimal: String(opts.amount),
    },
  };
}

function invoice(opts: {
  id: string;
  status?: 'paid' | 'open' | 'uncollectible' | 'void' | 'draft';
  finalizedAt?: number | null;
  created?: number;
  currency?: string;
  lines: StripeInvoiceLineItemLike[];
}): StripeInvoiceLike {
  const finalized = opts.finalizedAt ?? opts.created ?? MAR_05;
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
    created: opts.created ?? finalized,
    status_transitions: {
      finalized_at: finalized,
      paid_at: opts.status === 'paid' ? finalized : null,
      voided_at: opts.status === 'void' ? finalized : null,
      marked_uncollectible_at:
        opts.status === 'uncollectible' ? finalized : null,
    },
    lines: { data: opts.lines },
  };
}

const PRODUCTS: StripeProductLike[] = [
  { id: 'prod_pro', name: 'Pro', active: true },
  { id: 'prod_starter', name: 'Starter', active: true },
  { id: 'prod_advice_access', name: 'Advice Access', active: true },
];

describe('revenue_by_plan_billed', () => {
  // ── Legacy-shape coverage (matches fixture) ───────────────────────────

  it('legacy shape — groups lines by plan via price.nickname', () => {
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_1',
          lines: [legacyLine({ amount: 100000, nickname: 'Pro Monthly' })],
        }),
        invoice({
          id: 'in_2',
          lines: [legacyLine({ amount: 50000, nickname: 'Starter Monthly' })],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].plan_name).toBe('Pro Monthly');
    expect(r.rows[0].amount).toBe(1000);
    expect(r.rows[1].plan_name).toBe('Starter Monthly');
    expect(r.rows[1].amount).toBe(500);
    expect(r.totals_by_currency).toEqual({ usd: 1500 });
  });

  it('legacy shape — falls back to productById when nickname is null', () => {
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_1',
          lines: [
            legacyLine({
              amount: 24500,
              nickname: null,
              productId: 'prod_advice_access',
            }),
          ],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows[0].plan_name).toBe('Advice Access');
    expect(r.rows[0].amount).toBe(245);
  });

  it('legacy shape — falls back to expanded product.name when productById missing', () => {
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_1',
          lines: [
            legacyLine({
              amount: 100000,
              nickname: null,
              productId: 'prod_unknown',
              productName: 'Inline Enterprise',
            }),
          ],
        }),
      ],
      products: [],            // empty products map
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows[0].plan_name).toBe('Inline Enterprise');
  });

  // ── New-shape coverage (production reality) ────────────────────────────

  it('new shape — resolves plan name via pricing.price_details.product + productById', () => {
    // Merchant A production scenario: line.price is absent; line.pricing
    // is populated with price_details carrying string IDs.
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_advice_new',
          currency: 'cad',
          lines: [
            newShapeLine({
              amount: 2500,
              productId: 'prod_advice_access',
              priceId: 'price_advice',
            }),
          ],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].plan_name).toBe('Advice Access');
    expect(r.rows[0].currency).toBe('cad');
    expect(r.rows[0].amount).toBe(25);
    expect(r.totals_by_currency).toEqual({ cad: 25 });
  });

  it('new shape — falls through to unattributed when product not in map', () => {
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_missing',
          lines: [
            newShapeLine({ amount: 5000, productId: 'prod_not_in_map' }),
          ],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows[0].plan_name).toBe('unattributed');
    expect(r.rows[0].amount).toBe(50);
  });

  it('mixed shapes — invoices with legacy AND new shape both attribute correctly', () => {
    // Cross-shape merchant: one invoice on legacy API, one on new API. Both
    // should resolve cleanly. Stresses the dual-shape defensive reading.
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_legacy',
          lines: [legacyLine({ amount: 100000, nickname: 'Pro Monthly' })],
        }),
        invoice({
          id: 'in_new',
          lines: [
            newShapeLine({ amount: 2500, productId: 'prod_advice_access' }),
          ],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows).toHaveLength(2);
    const pro = r.rows.find((row) => row.plan_name === 'Pro Monthly');
    const advice = r.rows.find((row) => row.plan_name === 'Advice Access');
    expect(pro?.amount).toBe(1000);
    expect(advice?.amount).toBe(25);
  });

  // ── Aggregation semantics ────────────────────────────────────────────

  it('per-LINE attribution (not first-line-wins)', () => {
    // Multi-line invoice: one line Pro, one line Starter. Each line attributes
    // to its OWN plan — no first-line-wins shortcut.
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_multi',
          lines: [
            legacyLine({ amount: 100000, nickname: 'Pro Monthly' }),
            legacyLine({ amount: 50000, nickname: 'Starter Monthly' }),
          ],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].plan_name).toBe('Pro Monthly');
    expect(r.rows[0].amount).toBe(1000);
    expect(r.rows[1].plan_name).toBe('Starter Monthly');
    expect(r.rows[1].amount).toBe(500);
  });

  it('invoice_count counts distinct invoices, line_count counts lines', () => {
    // 2 invoices, both Pro Monthly, one with 2 lines (proration).
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_a',
          lines: [legacyLine({ amount: 100000, nickname: 'Pro Monthly' })],
        }),
        invoice({
          id: 'in_b',
          lines: [
            legacyLine({ amount: 50000, nickname: 'Pro Monthly' }),
            legacyLine({ amount: 25000, nickname: 'Pro Monthly' }),
          ],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows[0].invoice_count).toBe(2);
    expect(r.rows[0].line_count).toBe(3);
    expect(r.rows[0].amount).toBe(1750);
  });

  // ── Filtering: status + period ───────────────────────────────────────

  it('excludes void and draft invoices', () => {
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_paid',
          status: 'paid',
          lines: [legacyLine({ amount: 100000, nickname: 'Pro Monthly' })],
        }),
        invoice({
          id: 'in_void',
          status: 'void',
          lines: [legacyLine({ amount: 50000, nickname: 'Pro Monthly' })],
        }),
        invoice({
          id: 'in_draft',
          status: 'draft',
          lines: [legacyLine({ amount: 25000, nickname: 'Pro Monthly' })],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].amount).toBe(1000); // only paid counts
    expect(r.rows[0].invoice_count).toBe(1);
  });

  it('counts open and uncollectible invoices (match period_billed_revenue)', () => {
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_paid',
          status: 'paid',
          lines: [legacyLine({ amount: 100000, nickname: 'Pro Monthly' })],
        }),
        invoice({
          id: 'in_open',
          status: 'open',
          lines: [legacyLine({ amount: 50000, nickname: 'Pro Monthly' })],
        }),
        invoice({
          id: 'in_unc',
          status: 'uncollectible',
          lines: [legacyLine({ amount: 25000, nickname: 'Pro Monthly' })],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows[0].amount).toBe(1750);
    expect(r.rows[0].invoice_count).toBe(3);
  });

  it('uses finalized_at when present, falls back to created', () => {
    // Invoice with finalized_at outside period but created inside → excluded.
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_late',
          created: MAR_25,
          finalizedAt: APR_10,                 // outside March
          lines: [legacyLine({ amount: 100000, nickname: 'Pro Monthly' })],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows).toHaveLength(0);
  });

  // ── Multi-currency ───────────────────────────────────────────────────

  it('multi-currency — sorts dominant-currency block first, no cross-currency sum', () => {
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_usd',
          currency: 'usd',
          lines: [legacyLine({ amount: 50000, nickname: 'Pro Monthly' })],
        }),
        invoice({
          id: 'in_cad',
          currency: 'cad',
          lines: [legacyLine({ amount: 200000, nickname: 'Pro Monthly' })],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.rows).toHaveLength(2);
    // CAD has higher minor-unit total → CAD row first
    expect(r.rows[0].currency).toBe('cad');
    expect(r.rows[0].amount).toBe(2000);
    expect(r.rows[1].currency).toBe('usd');
    expect(r.rows[1].amount).toBe(500);
    expect(r.totals_by_currency).toEqual({ cad: 2000, usd: 500 });
  });

  it('shares are per-currency (not cross-currency)', () => {
    const r = revenueByPlanBilled({
      invoices: [
        invoice({
          id: 'in_a',
          currency: 'usd',
          lines: [legacyLine({ amount: 75000, nickname: 'Pro Monthly' })],
        }),
        invoice({
          id: 'in_b',
          currency: 'usd',
          lines: [legacyLine({ amount: 25000, nickname: 'Starter Monthly' })],
        }),
        invoice({
          id: 'in_c',
          currency: 'cad',
          lines: [legacyLine({ amount: 100000, nickname: 'Pro Monthly' })],
        }),
      ],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    const proUsd = r.rows.find((row) => row.plan_name === 'Pro Monthly' && row.currency === 'usd');
    const starterUsd = r.rows.find((row) => row.plan_name === 'Starter Monthly');
    const proCad = r.rows.find((row) => row.plan_name === 'Pro Monthly' && row.currency === 'cad');
    expect(proUsd?.share).toBeCloseTo(0.75, 5);
    expect(starterUsd?.share).toBeCloseTo(0.25, 5);
    expect(proCad?.share).toBeCloseTo(1.0, 5);
  });

  // ── Envelope ──────────────────────────────────────────────────────────

  it('output envelope: rows kind, definition, period, as_of, table metadata', () => {
    const r = revenueByPlanBilled({
      invoices: [],
      products: PRODUCTS,
      period: MARCH_2026,
      now: NOW,
    });
    if (r.kind !== 'rows') throw new Error('expected rows');
    expect(r.kind).toBe('rows');
    expect(r.definition).toBe('javelin_defined.revenue_by_plan_billed');
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.period).toEqual(MARCH_2026);
    expect(r.totals_by_currency).toEqual({});
    expect(r.table).toBeDefined();
    expect(r.table.columns.map((c) => c.field)).toContain('plan_name');
  });

  // ── Series mode (Phase 2C-post-v2 S1=A) ───────────────────────────────

  describe('series mode', () => {
    it('granularity=month → dense buckets, plans aligned', () => {
      const r = revenueByPlanBilled({
        invoices: [
          invoice({
            id: 'in_a',
            created: MAR_05,
            finalizedAt: MAR_05,
            lines: [legacyLine({ amount: 100000, nickname: 'Pro Monthly' })],
          }),
          invoice({
            id: 'in_b',
            created: MAR_15,
            finalizedAt: MAR_15,
            lines: [legacyLine({ amount: 200000, nickname: 'Pro Monthly' })],
          }),
        ],
        products: PRODUCTS,
        period: MARCH_2026,
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.granularity).toBe('month');
      expect(r.buckets).toEqual(['2026-03']);
      expect(r.groups).toHaveLength(1);
      expect(r.groups[0].plan_name).toBe('Pro Monthly');
      expect(r.groups[0].total).toBe(3000);
      expect(r.groups[0].invoice_count).toBe(2);
      expect(r.groups[0].series[0].amount).toBe(3000);
    });

    it('granularity=week → dense zero-fill, multi-week distribution', () => {
      const r = revenueByPlanBilled({
        invoices: [
          invoice({
            id: 'in_a',
            created: MAR_05,
            finalizedAt: MAR_05,
            lines: [legacyLine({ amount: 100000, nickname: 'Pro Monthly' })],
          }),
          invoice({
            id: 'in_b',
            created: MAR_25,
            finalizedAt: MAR_25,
            lines: [legacyLine({ amount: 50000, nickname: 'Pro Monthly' })],
          }),
        ],
        products: PRODUCTS,
        period: MARCH_2026,
        now: NOW,
        granularity: 'week',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      // March 2026 weeks (Monday-start): 02-23, 03-02, 03-09, 03-16, 03-23, 03-30
      expect(r.buckets).toEqual([
        '2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16',
        '2026-03-23', '2026-03-30',
      ]);
      // Pro Monthly: week of 03-02 ($1,000), week of 03-23 ($500), others zero
      expect(r.groups[0].series.map((p) => p.amount)).toEqual([0, 1000, 0, 0, 500, 0]);
    });

    it('new-shape lines in series mode resolve via productById', () => {
      const r = revenueByPlanBilled({
        invoices: [
          invoice({
            id: 'in_advice',
            currency: 'cad',
            created: MAR_05,
            finalizedAt: MAR_05,
            lines: [
              newShapeLine({ amount: 2500, productId: 'prod_advice_access' }),
            ],
          }),
        ],
        products: PRODUCTS,
        period: MARCH_2026,
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.groups).toHaveLength(1);
      expect(r.groups[0].plan_name).toBe('Advice Access');
      expect(r.groups[0].total).toBe(25);
    });

    it('series empty input → empty groups, dense buckets still emitted', () => {
      const r = revenueByPlanBilled({
        invoices: [],
        products: PRODUCTS,
        period: MARCH_2026,
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.groups).toHaveLength(0);
      expect(r.buckets).toEqual(['2026-03']);
      expect(r.totals_by_currency).toEqual({});
    });
  });
});
