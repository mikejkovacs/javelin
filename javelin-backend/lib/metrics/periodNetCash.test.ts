import { describe, it, expect } from 'vitest';
import { periodNetCash } from './periodNetCash';
import type { StripeBalanceTransactionLike } from './chargeEnriched';

const NOW = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const PERIOD = { start: NOW_SEC - 86400 * 30, end: NOW_SEC };

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

describe('periodNetCash', () => {
  it('empty BTs → empty rows', () => {
    const r = periodNetCash({ balanceTransactions: [], period: PERIOD, now: NOW });
    expect(r.rows).toEqual([]);
  });

  it('sums bt.net for allowlisted types', () => {
    const r = periodNetCash({
      balanceTransactions: [
        makeBt({ id: 't1', net: 9941, type: 'charge' }),
        makeBt({ id: 't2', net: -500, type: 'refund' }),
        makeBt({ id: 't3', net: -200, type: 'adjustment' }),
        makeBt({ id: 't4', net: -100, type: 'payment_refund' }),
        makeBt({ id: 't5', net: -5000, type: 'dispute' }),
      ],
      period: PERIOD,
      now: NOW,
    });
    // 9941 - 500 - 200 - 100 - 5000 = 4141 minor → $41.41
    expect(r.rows[0].net_cash).toBeCloseTo(41.41, 5);
    expect(r.rows[0].transaction_count).toBe(5);
  });

  it('excludes non-allowlisted types (stripe_fee, application_fee, payout, transfer)', () => {
    const r = periodNetCash({
      balanceTransactions: [
        makeBt({ id: 't1', net: 9941, type: 'charge' }),
        makeBt({ id: 't2', net: -2000, type: 'stripe_fee' }),
        makeBt({ id: 't3', net: -1000, type: 'application_fee' }),
        makeBt({ id: 't4', net: -9000, type: 'payout' }),
        makeBt({ id: 't5', net: -500, type: 'transfer' }),
        makeBt({ id: 't6', net: -100, type: 'application_fee_refund' }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].net_cash).toBeCloseTo(99.41, 5);
    expect(r.rows[0].transaction_count).toBe(1);
  });

  it('filters BTs strictly by bt.created in period (M2.1-S3-C)', () => {
    const r = periodNetCash({
      balanceTransactions: [
        makeBt({ id: 'in', net: 5000, created: NOW_SEC - 86400 }),
        makeBt({ id: 'before', net: 5000, created: PERIOD.start - 1 }),
        makeBt({ id: 'after', net: 5000, created: PERIOD.end + 1 }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].net_cash).toBeCloseTo(50, 5);
    expect(r.rows[0].transaction_count).toBe(1);
  });

  it('groups by bt.currency, sorted alphabetically (M2.1-S4)', () => {
    const r = periodNetCash({
      balanceTransactions: [
        makeBt({ id: 't1', net: 10000, currency: 'usd' }),
        makeBt({ id: 't2', net: 5000, currency: 'eur' }),
        makeBt({ id: 't3', net: 1000, currency: 'jpy' }),
      ],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows.map((r) => r.currency)).toEqual(['eur', 'jpy', 'usd']);
  });

  it('zero-decimal currency (JPY) — net is already whole units', () => {
    const r = periodNetCash({
      balanceTransactions: [makeBt({ net: 970, currency: 'jpy' })],
      period: PERIOD,
      now: NOW,
    });
    expect(r.rows[0].net_cash).toBe(970);
  });

  it('envelope: definition + period + kind', () => {
    const r = periodNetCash({
      balanceTransactions: [makeBt()],
      period: PERIOD,
      now: NOW,
    });
    expect(r.kind).toBe('rows');
    expect(r.definition).toBe('stripe_balance_transaction.net_aggregation');
    expect(r.period).toEqual(PERIOD);
    expect(r.as_of).toBe(NOW_SEC);
  });
});
