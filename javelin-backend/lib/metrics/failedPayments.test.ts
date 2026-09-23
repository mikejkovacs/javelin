import { describe, it, expect } from 'vitest';
import { failedPayments } from './failedPayments';
import type { StripeChargeLike } from './chargeEnriched';
import type { StripeInvoiceLike } from './invoiceEnriched';

const NOW = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const PERIOD = { start: NOW_SEC - 86400 * 30, end: NOW_SEC };

function failedCharge(o: {
  id?: string;
  customer?: string | null;
  amount?: number;
  currency?: string;
  created?: number;
  failure_code?: string | null;
  outcome_reason?: string | null;
}): StripeChargeLike {
  return {
    id: o.id ?? 'ch_failed',
    customer: o.customer === undefined ? 'cus_test' : o.customer,
    amount: o.amount ?? 10000,
    amount_refunded: 0,
    currency: o.currency ?? 'usd',
    status: 'failed',
    created: o.created ?? NOW_SEC - 86400,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    failure_code: o.failure_code ?? null,
    outcome: o.outcome_reason ? { reason: o.outcome_reason } : null,
  };
}

function succeededCharge(o: { id?: string; amount?: number; created?: number } = {}): StripeChargeLike {
  return {
    id: o.id ?? 'ch_ok',
    customer: 'cus_test',
    amount: o.amount ?? 10000,
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    created: o.created ?? NOW_SEC - 86400,
    disputed: false,
    refunded: false,
    balance_transaction: null,
  };
}

function failedInvoice(o: {
  id?: string;
  customer?: string;
  total?: number;
  currency?: string;
  status?: 'open' | 'uncollectible' | 'paid' | 'void' | 'draft';
  attempt_count?: number;
  finalized_at?: number;
}): StripeInvoiceLike {
  return {
    id: o.id ?? 'in_failed',
    customer: o.customer ?? 'cus_test',
    status: o.status ?? 'open',
    total: o.total ?? 50000,
    subtotal: o.total ?? 50000,
    total_excluding_tax: o.total ?? 50000,
    tax: 0,
    amount_paid: 0,
    amount_due: o.total ?? 50000,
    amount_remaining: o.total ?? 50000,
    currency: o.currency ?? 'usd',
    created: o.finalized_at ?? NOW_SEC - 86400,
    attempt_count: o.attempt_count ?? 1,
    status_transitions: {
      finalized_at: o.finalized_at ?? NOW_SEC - 86400,
      paid_at: null,
      voided_at: null,
      marked_uncollectible_at: null,
    },
    lines: { data: [] },
  };
}

describe('failedPayments — empty', () => {
  it('empty input → empty rows + empty top_failures + empty failure_reasons', () => {
    const r = failedPayments({
      charges: [],
      invoices: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows).toEqual([]);
    expect(r.top_failures).toEqual([]);
    expect(r.failure_reasons).toEqual([]);
    expect(r.kind).toBe('rows');
    expect(r.definition).toBe('javelin_defined.failed_payments');
    expect(r.period).toEqual(PERIOD);
    expect(r.truncated).toBe(false);
  });
});

describe('failedPayments — charge-side failures', () => {
  it('counts only charges with status="failed"', () => {
    const r = failedPayments({
      charges: [
        failedCharge({ id: 'f1', amount: 10000, failure_code: 'insufficient_funds' }),
        succeededCharge({ id: 's1', amount: 5000 }),
        failedCharge({ id: 'f2', amount: 7500, failure_code: 'expired_card' }),
      ],
      invoices: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].count).toBe(2);
    expect(r.rows[0].total_failed).toBeCloseTo(175, 5);
    expect(r.rows[0].breakdown.failed_charges).toEqual({ amount: 175, count: 2 });
    expect(r.rows[0].breakdown.failed_invoice_attempts).toEqual({ amount: 0, count: 0 });
  });

  it('excludes failed charges outside the period window', () => {
    const r = failedPayments({
      charges: [
        failedCharge({ id: 'in', amount: 10000, created: NOW_SEC - 86400 * 5 }),
        failedCharge({ id: 'out', amount: 99999, created: PERIOD.start - 86400 }),
      ],
      invoices: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].count).toBe(1);
    expect(r.rows[0].total_failed).toBeCloseTo(100, 5);
  });

  it('groups by currency', () => {
    const r = failedPayments({
      charges: [
        failedCharge({ id: 'f1', amount: 10000, currency: 'usd' }),
        failedCharge({ id: 'f2', amount: 5000, currency: 'eur' }),
        failedCharge({ id: 'f3', amount: 1000, currency: 'jpy' }),
      ],
      invoices: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows.map((row) => row.currency)).toEqual(['eur', 'jpy', 'usd']);
  });
});

describe('failedPayments — invoice-side failures', () => {
  it('counts open invoices with attempt_count > 0', () => {
    const r = failedPayments({
      charges: [],
      invoices: [
        failedInvoice({ id: 'inv1', total: 50000, attempt_count: 1, status: 'open' }),
        failedInvoice({ id: 'inv2', total: 30000, attempt_count: 2, status: 'open' }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].breakdown.failed_invoice_attempts).toEqual({
      amount: 800,
      count: 2,
    });
  });

  it('counts uncollectible invoices with attempt_count > 0', () => {
    const r = failedPayments({
      charges: [],
      invoices: [failedInvoice({ total: 25000, status: 'uncollectible', attempt_count: 3 })],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].breakdown.failed_invoice_attempts).toEqual({
      amount: 250,
      count: 1,
    });
  });

  it('excludes draft / paid / void invoices regardless of attempt_count', () => {
    const r = failedPayments({
      charges: [],
      invoices: [
        failedInvoice({ id: 'd', status: 'draft', attempt_count: 5 }),
        failedInvoice({ id: 'p', status: 'paid', attempt_count: 3 }),
        failedInvoice({ id: 'v', status: 'void', attempt_count: 2 }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows).toEqual([]);
  });

  it('excludes invoices with attempt_count = 0', () => {
    const r = failedPayments({
      charges: [],
      invoices: [failedInvoice({ status: 'open', attempt_count: 0 })],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows).toEqual([]);
  });

  it('excludes invoices outside the period (by finalized_at)', () => {
    const r = failedPayments({
      charges: [],
      invoices: [
        failedInvoice({
          id: 'old',
          finalized_at: PERIOD.start - 86400 * 60,
          attempt_count: 2,
        }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows).toEqual([]);
  });
});

describe('failedPayments — combined charge + invoice', () => {
  it('combines into one currency row with both breakdown subtotals', () => {
    const r = failedPayments({
      charges: [failedCharge({ amount: 10000, failure_code: 'card_declined' })],
      invoices: [failedInvoice({ total: 50000, attempt_count: 1, status: 'open' })],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].count).toBe(2);
    expect(r.rows[0].total_failed).toBeCloseTo(600, 5);
    expect(r.rows[0].breakdown.failed_charges).toEqual({ amount: 100, count: 1 });
    expect(r.rows[0].breakdown.failed_invoice_attempts).toEqual({ amount: 500, count: 1 });
  });
});

describe('failedPayments — top_failures', () => {
  it('default top 5, sorted by amount desc', () => {
    const charges = [
      failedCharge({ id: 'f1', amount: 100 }),
      failedCharge({ id: 'f2', amount: 200 }),
      failedCharge({ id: 'f3', amount: 300 }),
      failedCharge({ id: 'f4', amount: 400 }),
      failedCharge({ id: 'f5', amount: 500 }),
      failedCharge({ id: 'f6', amount: 600 }),
      failedCharge({ id: 'f7', amount: 700 }),
    ];
    const r = failedPayments({ charges, invoices: [], period: PERIOD, now: NOW });
    expect(r.top_failures).toHaveLength(5);
    // amounts in major units = 7,6,5,4,3 (×0.01 from minor)
    expect(r.top_failures.map((f) => f.amount)).toEqual([7, 6, 5, 4, 3]);
  });

  it('honors topN parameter (custom value)', () => {
    const charges = Array.from({ length: 10 }, (_, i) =>
      failedCharge({ id: `f${i}`, amount: (i + 1) * 100 }),
    );
    const r = failedPayments({ charges, invoices: [], period: PERIOD, now: NOW, topN: 3 });
    expect(r.top_failures).toHaveLength(3);
  });

  it('caps topN at 20', () => {
    const charges = Array.from({ length: 30 }, (_, i) =>
      failedCharge({ id: `f${i}`, amount: (i + 1) * 100 }),
    );
    const r = failedPayments({ charges, invoices: [], period: PERIOD, now: NOW, topN: 50 });
    expect(r.top_failures).toHaveLength(20);
  });

  it('floors topN at 1', () => {
    const charges = [failedCharge({ amount: 100 })];
    const r = failedPayments({ charges, invoices: [], period: PERIOD, now: NOW, topN: 0 });
    expect(r.top_failures).toHaveLength(1);
  });

  it('combines charge and invoice failures in top_failures', () => {
    const r = failedPayments({
      charges: [failedCharge({ id: 'ch_big', amount: 100000 })], // $1,000
      invoices: [failedInvoice({ id: 'in_huge', total: 500000, attempt_count: 1 })], // $5,000
      period: PERIOD,
      now: NOW,
    });
    expect(r.top_failures).toHaveLength(2);
    // Invoice $5,000 > Charge $1,000
    expect(r.top_failures[0].failure_type).toBe('invoice_attempt');
    expect(r.top_failures[1].failure_type).toBe('charge');
  });
});

describe('failedPayments — failure_reasons', () => {
  it('buckets common Stripe codes into operator-friendly categories', () => {
    const r = failedPayments({
      charges: [
        failedCharge({ id: 'a', failure_code: 'insufficient_funds' }),
        failedCharge({ id: 'b', failure_code: 'insufficient_funds' }),
        failedCharge({ id: 'c', failure_code: 'expired_card' }),
        failedCharge({ id: 'd', failure_code: 'card_declined' }),
        failedCharge({ id: 'e', failure_code: 'do_not_honor' }), // → card_declined
      ],
      invoices: [],
      period: PERIOD,
      now: NOW,
    });
    const byCategory = Object.fromEntries(
      r.failure_reasons.map((b) => [b.category, b.count]),
    );
    expect(byCategory['insufficient_funds']).toBe(2);
    expect(byCategory['expired_card']).toBe(1);
    expect(byCategory['card_declined']).toBe(2); // card_declined + do_not_honor
  });

  it('caps at top 3 by count', () => {
    const r = failedPayments({
      charges: [
        failedCharge({ id: 'a', failure_code: 'insufficient_funds' }),
        failedCharge({ id: 'b', failure_code: 'insufficient_funds' }),
        failedCharge({ id: 'c', failure_code: 'insufficient_funds' }),
        failedCharge({ id: 'd', failure_code: 'expired_card' }),
        failedCharge({ id: 'e', failure_code: 'expired_card' }),
        failedCharge({ id: 'f', failure_code: 'card_declined' }),
        failedCharge({ id: 'g', failure_code: 'processing_error' }), // 4th category
        failedCharge({ id: 'h', failure_code: 'authentication_required' }), // 5th
      ],
      invoices: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.failure_reasons).toHaveLength(3);
    expect(r.failure_reasons[0].category).toBe('insufficient_funds');
  });

  it('prefers outcome.reason over failure_code', () => {
    const r = failedPayments({
      charges: [
        failedCharge({
          failure_code: 'card_declined',
          outcome_reason: 'insufficient_funds', // more specific, takes priority
        }),
      ],
      invoices: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.failure_reasons[0].category).toBe('insufficient_funds');
  });

  it('unmapped codes fall to "other"', () => {
    const r = failedPayments({
      charges: [failedCharge({ failure_code: 'some_weird_code_we_dont_map' })],
      invoices: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.failure_reasons[0].category).toBe('other');
  });

  it('missing failure_code/outcome.reason → "other"', () => {
    const r = failedPayments({
      charges: [failedCharge({ failure_code: null })],
      invoices: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.failure_reasons[0].category).toBe('other');
  });

  it('does NOT include invoice-side failures in failure_reasons', () => {
    const r = failedPayments({
      charges: [],
      invoices: [failedInvoice({ attempt_count: 5 })],
      period: PERIOD,
      now: NOW,
    });
    expect(r.failure_reasons).toEqual([]);
  });
});

describe('failedPayments — envelope', () => {
  it('passes truncated flag through', () => {
    const r = failedPayments({
      charges: [],
      invoices: [],
      period: PERIOD,
      now: NOW,
      truncated: true,
    });
    expect(r.truncated).toBe(true);
  });
});
