import { describe, it, expect } from 'vitest';
import { periodCollectedRevenue } from './periodCollectedRevenue';
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

describe('periodCollectedRevenue', () => {
  it('empty charges → empty rows', () => {
    const r = periodCollectedRevenue({
      charges: [],
      balanceTransactions: [],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows).toEqual([]);
  });

  it('sums amount − amount_refunded for succeeded charges in period', () => {
    const r = periodCollectedRevenue({
      charges: [
        makeCharge({ id: 'ch_1', amount: 10000, amount_refunded: 0 }),
        makeCharge({ id: 'ch_2', amount: 5000, amount_refunded: 1000 }),
        makeCharge({ id: 'ch_3', amount: 2500, amount_refunded: 2500 }),
      ],
      balanceTransactions: [makeBt()],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].currency).toBe('usd');
    expect(r.rows[0].collected_revenue).toBeCloseTo(140.0, 5);
    expect(r.rows[0].charge_count).toBe(3);
  });

  it('excludes failed and pending charges', () => {
    const r = periodCollectedRevenue({
      charges: [
        makeCharge({ id: 'ch_1', amount: 10000, status: 'succeeded' }),
        makeCharge({ id: 'ch_2', amount: 5000, status: 'failed' }),
        makeCharge({ id: 'ch_3', amount: 3000, status: 'pending' }),
      ],
      balanceTransactions: [makeBt()],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].collected_revenue).toBeCloseTo(100.0, 5);
    expect(r.rows[0].charge_count).toBe(1);
  });

  it('excludes charges outside period window', () => {
    const r = periodCollectedRevenue({
      charges: [
        makeCharge({ id: 'ch_in', amount: 10000, created: NOW_SEC - 86400 }),
        makeCharge({ id: 'ch_before', amount: 20000, created: PERIOD.start - 1 }),
        makeCharge({ id: 'ch_after', amount: 30000, created: PERIOD.end + 1 }),
      ],
      balanceTransactions: [makeBt()],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].collected_revenue).toBeCloseTo(100.0, 5);
    expect(r.rows[0].charge_count).toBe(1);
  });

  it('groups by currency, sorted alphabetically', () => {
    const r = periodCollectedRevenue({
      charges: [
        makeCharge({ id: 'c1', amount: 10000, currency: 'usd' }),
        makeCharge({ id: 'c2', amount: 5000, currency: 'eur' }),
        makeCharge({ id: 'c3', amount: 1000, currency: 'jpy' }),
      ],
      balanceTransactions: [makeBt()],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows.map((r) => r.currency)).toEqual(['eur', 'jpy', 'usd']);
  });

  it('zero-decimal currency (JPY)', () => {
    const r = periodCollectedRevenue({
      charges: [makeCharge({ amount: 1500, amount_refunded: 500, currency: 'jpy' })],
      balanceTransactions: [makeBt({ currency: 'jpy' })],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].collected_revenue).toBe(1000);
  });

  describe('exclude_fraud', () => {
    it('default false — fraud charges counted', () => {
      const r = periodCollectedRevenue({
        charges: [
          makeCharge({ id: 'ch_1', amount: 10000 }),
          {
            ...makeCharge({ id: 'ch_2', amount: 5000 }),
            fraud_details: { user_report: 'fraudulent', stripe_report: null },
          },
        ],
        balanceTransactions: [makeBt()],
        period: PERIOD,
        now: NOW,
      });
      expect(r.rows[0].collected_revenue).toBeCloseTo(150.0, 5);
      expect(r.rows[0].charge_count).toBe(2);
      expect(r.rows[0].fraud_excluded).toBe(0);
    });

    it('true — drops fraud charges and reports volume removed', () => {
      const r = periodCollectedRevenue({
        charges: [
          makeCharge({ id: 'ch_1', amount: 10000 }),
          {
            ...makeCharge({ id: 'ch_2', amount: 5000 }),
            fraud_details: { user_report: 'fraudulent', stripe_report: null },
          },
          {
            ...makeCharge({ id: 'ch_3', amount: 3000 }),
            fraud_details: { user_report: null, stripe_report: 'fraudulent' },
          },
        ],
        balanceTransactions: [makeBt()],
        period: PERIOD,
        now: NOW,
        excludeFraud: true,
      });
      expect(r.rows[0].collected_revenue).toBeCloseTo(100.0, 5);
      expect(r.rows[0].charge_count).toBe(1);
      expect(r.rows[0].fraud_excluded).toBeCloseTo(80.0, 5);
    });
  });

  it('envelope: definition + as_of + period + kind', () => {
    const r = periodCollectedRevenue({
      charges: [makeCharge()],
      balanceTransactions: [makeBt()],
      period: PERIOD,
      now: NOW,
    });
    expect(r.kind).toBe('rows');
    expect(r.definition).toBe('javelin_derived.period_collected_revenue');
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.period).toEqual(PERIOD);
  });
});
