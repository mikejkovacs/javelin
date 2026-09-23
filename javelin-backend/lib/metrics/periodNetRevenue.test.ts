import { describe, it, expect } from 'vitest';
import { periodNetRevenue, type StripeDisputeLike } from './periodNetRevenue';
import type { StripeChargeLike, StripeBalanceTransactionLike } from './chargeEnriched';

const NOW = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const PERIOD = { start: NOW_SEC - 86400 * 30, end: NOW_SEC };

function makeCharge(o: Partial<StripeChargeLike> = {}): StripeChargeLike {
  return {
    id: o.id ?? 'ch_test',
    customer: o.customer ?? 'cus_test',
    amount: o.amount ?? 10000,
    amount_refunded: o.amount_refunded ?? 0,
    currency: o.currency ?? 'usd',
    status: o.status ?? 'succeeded',
    created: o.created ?? NOW_SEC - 86400,
    disputed: o.disputed ?? false,
    refunded: o.refunded ?? false,
    balance_transaction: o.balance_transaction ?? 'txn_test',
    payment_method_details: null,
    billing_details: null,
  };
}

function makeBt(o: Partial<StripeBalanceTransactionLike> = {}): StripeBalanceTransactionLike {
  return {
    id: o.id ?? 'txn_test',
    fee: o.fee ?? 59,
    net: o.net ?? 9941,
    currency: o.currency ?? 'usd',
    type: o.type ?? 'charge',
    created: o.created ?? NOW_SEC - 3600,
  };
}

function makeDispute(o: Partial<StripeDisputeLike> = {}): StripeDisputeLike {
  return {
    id: o.id ?? 'dp_test',
    amount: o.amount ?? 10000,
    currency: o.currency ?? 'usd',
    status: o.status ?? 'lost',
    created: o.created ?? NOW_SEC - 86400,
  };
}

describe('periodNetRevenue', () => {
  it('empty input → empty rows', () => {
    const r = periodNetRevenue({
      charges: [],
      balanceTransactions: [],
      disputes: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows).toEqual([]);
  });

  it('basic: gross_collected − refunds − chargebacks', () => {
    const r = periodNetRevenue({
      charges: [
        makeCharge({ id: 'c1', amount: 10000, amount_refunded: 0 }),
        makeCharge({ id: 'c2', amount: 5000, amount_refunded: 1000 }),
      ],
      balanceTransactions: [makeBt()],
      disputes: [makeDispute({ amount: 2000, status: 'lost' })],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].gross_collected).toBeCloseTo(150, 5);
    expect(r.rows[0].refunds).toBeCloseTo(10, 5);
    expect(r.rows[0].chargebacks).toBeCloseTo(20, 5);
    expect(r.rows[0].net_revenue).toBeCloseTo(120, 5);
  });

  it('includes dispute status warning_closed', () => {
    const r = periodNetRevenue({
      charges: [makeCharge({ amount: 10000 })],
      balanceTransactions: [makeBt()],
      disputes: [makeDispute({ amount: 3000, status: 'warning_closed' })],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].chargebacks).toBeCloseTo(30, 5);
  });

  it('excludes non-lost dispute statuses (won, under_review, needs_response)', () => {
    const r = periodNetRevenue({
      charges: [makeCharge({ amount: 10000 })],
      balanceTransactions: [makeBt()],
      disputes: [
        makeDispute({ id: 'd1', amount: 1000, status: 'won' }),
        makeDispute({ id: 'd2', amount: 1000, status: 'under_review' }),
        makeDispute({ id: 'd3', amount: 1000, status: 'needs_response' }),
        makeDispute({ id: 'd4', amount: 1000, status: 'warning_needs_response' }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].chargebacks).toBe(0);
  });

  it('filters disputes by dispute.created, not charge.created', () => {
    // Charge from OUTSIDE the period; dispute created INSIDE the period.
    // Per M2.1-S1: dispute contributes to *this* period's net_revenue.
    const r = periodNetRevenue({
      charges: [
        makeCharge({
          id: 'old_ch',
          amount: 10000,
          created: PERIOD.start - 86400 * 60, // 2 months before period
        }),
      ],
      balanceTransactions: [makeBt()],
      disputes: [
        makeDispute({
          amount: 5000,
          status: 'lost',
          created: PERIOD.start + 3600, // inside the period
        }),
      ],
      period: PERIOD,
      now: NOW,
    });
    // The old charge is excluded from gross (outside period), but the dispute
    // still contributes. So net_revenue = 0 - 0 - 50 = -50.
    expect(r.rows[0].gross_collected).toBe(0);
    expect(r.rows[0].chargebacks).toBeCloseTo(50, 5);
    expect(r.rows[0].net_revenue).toBeCloseTo(-50, 5);
  });

  it('excludes disputes outside period', () => {
    const r = periodNetRevenue({
      charges: [makeCharge({ amount: 10000 })],
      balanceTransactions: [makeBt()],
      disputes: [
        makeDispute({ amount: 1000, created: PERIOD.start - 1 }),
        makeDispute({ amount: 1000, created: PERIOD.end + 1 }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].chargebacks).toBe(0);
  });

  it('excludes failed/pending charges from gross', () => {
    const r = periodNetRevenue({
      charges: [
        makeCharge({ id: 'c1', amount: 10000, status: 'succeeded' }),
        makeCharge({ id: 'c2', amount: 5000, status: 'failed' }),
      ],
      balanceTransactions: [makeBt()],
      disputes: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].gross_collected).toBeCloseTo(100, 5);
  });

  it('groups charges and disputes by currency', () => {
    const r = periodNetRevenue({
      charges: [
        makeCharge({ id: 'c1', amount: 10000, currency: 'usd' }),
        makeCharge({ id: 'c2', amount: 5000, currency: 'eur' }),
      ],
      balanceTransactions: [makeBt()],
      disputes: [
        makeDispute({ id: 'd1', amount: 1000, currency: 'usd' }),
        makeDispute({ id: 'd2', amount: 2000, currency: 'jpy' }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows.map((r) => r.currency)).toEqual(['eur', 'jpy', 'usd']);
    expect(r.rows.find((r) => r.currency === 'usd')!.chargebacks).toBeCloseTo(10, 5);
    expect(r.rows.find((r) => r.currency === 'jpy')!.chargebacks).toBe(2000);
    expect(r.rows.find((r) => r.currency === 'jpy')!.gross_collected).toBe(0);
  });

  describe('exclude_fraud', () => {
    it('default false — fraud charges counted in gross', () => {
      const r = periodNetRevenue({
        charges: [
          makeCharge({ id: 'c1', amount: 10000 }),
          {
            ...makeCharge({ id: 'c2', amount: 5000 }),
            fraud_details: { user_report: 'fraudulent', stripe_report: null },
          },
        ],
        balanceTransactions: [makeBt()],
        disputes: [],
        period: PERIOD,
        now: NOW,
      });
      expect(r.rows[0].gross_collected).toBeCloseTo(150, 5);
      expect(r.rows[0].fraud_excluded).toBe(0);
    });

    it('true — drops fraud charges from gross/refunds; chargebacks unaffected', () => {
      const r = periodNetRevenue({
        charges: [
          makeCharge({ id: 'c1', amount: 10000, amount_refunded: 1000 }),
          {
            ...makeCharge({ id: 'c2', amount: 5000, amount_refunded: 500 }),
            fraud_details: { user_report: 'fraudulent', stripe_report: null },
          },
        ],
        balanceTransactions: [makeBt()],
        disputes: [makeDispute({ amount: 2000, status: 'lost' })],
        period: PERIOD,
        now: NOW,
        excludeFraud: true,
      });
      expect(r.rows[0].gross_collected).toBeCloseTo(100, 5);
      expect(r.rows[0].refunds).toBeCloseTo(10, 5);
      expect(r.rows[0].chargebacks).toBeCloseTo(20, 5);
      expect(r.rows[0].net_revenue).toBeCloseTo(70, 5);
      // c2 net: 50 - 5 = 45
      expect(r.rows[0].fraud_excluded).toBeCloseTo(45, 5);
    });
  });

  it('envelope: definition + period + kind', () => {
    const r = periodNetRevenue({
      charges: [makeCharge()],
      balanceTransactions: [makeBt()],
      disputes: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.kind).toBe('rows');
    expect(r.definition).toBe('javelin_defined.period_net_revenue');
    expect(r.period).toEqual(PERIOD);
    expect(r.as_of).toBe(NOW_SEC);
  });
});
