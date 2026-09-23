import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { accountBalance } from './accountBalance';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const APR_30 = Math.floor(Date.UTC(2026, 3, 30, 0, 0, 0) / 1000);
const MAY_01 = Math.floor(Date.UTC(2026, 4, 1, 0, 0, 0) / 1000);
const MAY_03 = Math.floor(Date.UTC(2026, 4, 3, 0, 0, 0) / 1000);

function balance(
  available: Array<{ amount: number; currency: string }>,
  pending: Array<{ amount: number; currency: string }> = [],
  instant_available:
    | Array<{ amount: number; currency: string }>
    | null = null,
): Stripe.Balance {
  return {
    object: 'balance',
    available,
    pending,
    instant_available,
    livemode: false,
  } as unknown as Stripe.Balance;
}

function pendingTxn(
  net_minor: number,
  currency: string,
  available_on: number,
): Stripe.BalanceTransaction {
  return {
    id: `bt_${Math.random().toString(36).slice(2, 8)}`,
    status: 'pending',
    net: net_minor,
    currency,
    available_on,
  } as unknown as Stripe.BalanceTransaction;
}

describe('account_balance', () => {
  it('surfaces available, pending, and instant_available with major-unit conversion', () => {
    const r = accountBalance({
      balance: balance(
        [{ amount: 350000, currency: 'usd' }],
        [{ amount: 120000, currency: 'usd' }],
        [{ amount: 50000, currency: 'usd' }],
      ),
      pendingTransactions: [],
      now: NOW,
    });
    expect(r.available).toEqual([{ currency: 'usd', amount: 3500 }]);
    expect(r.pending).toEqual([{ currency: 'usd', amount: 1200 }]);
    expect(r.instant_available).toEqual([{ currency: 'usd', amount: 500 }]);
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.definition).toBe('stripe_canonical.balance_object');
  });

  it('returns null instant_available when Stripe returns null', () => {
    const r = accountBalance({
      balance: balance([{ amount: 100000, currency: 'usd' }]),
      pendingTransactions: [],
      now: NOW,
    });
    expect(r.instant_available).toBeNull();
  });

  it('multi-currency surfaces sort by amount desc within array', () => {
    const r = accountBalance({
      balance: balance([
        { amount: 50000, currency: 'usd' },
        { amount: 200000, currency: 'cad' },
      ]),
      pendingTransactions: [],
      now: NOW,
    });
    // Sort by major-unit amount desc: CAD 2000 > USD 500
    expect(r.available[0]).toEqual({ currency: 'cad', amount: 2000 });
    expect(r.available[1]).toEqual({ currency: 'usd', amount: 500 });
  });

  it('zero-decimal currency (jpy) divides by 1, not 100', () => {
    const r = accountBalance({
      balance: balance([{ amount: 12345, currency: 'jpy' }]),
      pendingTransactions: [],
      now: NOW,
    });
    expect(r.available[0]).toEqual({ currency: 'jpy', amount: 12345 });
  });

  it('pending_settlement_breakdown groups by (available_on, currency) and sums net', () => {
    const r = accountBalance({
      balance: balance(
        [{ amount: 350000, currency: 'usd' }],
        [{ amount: 120000, currency: 'usd' }],
      ),
      pendingTransactions: [
        pendingTxn(48500, 'usd', APR_30),
        pendingTxn(38800, 'usd', MAY_01),
        pendingTxn(33950, 'usd', MAY_03),
      ],
      now: NOW,
    });
    // Sort ascending by available_on
    expect(r.pending_settlement_breakdown).toHaveLength(3);
    expect(r.pending_settlement_breakdown[0]).toEqual({
      available_on: '2026-04-30',
      currency: 'usd',
      amount: 485,
      count: 1,
    });
    expect(r.pending_settlement_breakdown[1]).toEqual({
      available_on: '2026-05-01',
      currency: 'usd',
      amount: 388,
      count: 1,
    });
    expect(r.pending_settlement_breakdown[2]).toEqual({
      available_on: '2026-05-03',
      currency: 'usd',
      amount: 339.5,
      count: 1,
    });
  });

  it('pending_settlement_breakdown sums multiple txns sharing a (date, currency) bucket', () => {
    const r = accountBalance({
      balance: balance(
        [{ amount: 100000, currency: 'usd' }],
        [{ amount: 100000, currency: 'usd' }],
      ),
      pendingTransactions: [
        pendingTxn(40000, 'usd', APR_30),
        pendingTxn(60000, 'usd', APR_30),
      ],
      now: NOW,
    });
    expect(r.pending_settlement_breakdown).toHaveLength(1);
    expect(r.pending_settlement_breakdown[0]).toEqual({
      available_on: '2026-04-30',
      currency: 'usd',
      amount: 1000,
      count: 2,
    });
  });

  it('skips non-pending balance_transactions defensively', () => {
    const r = accountBalance({
      balance: balance(
        [{ amount: 100000, currency: 'usd' }],
        [{ amount: 50000, currency: 'usd' }],
      ),
      pendingTransactions: [
        pendingTxn(50000, 'usd', APR_30),
        // Defensive: even if caller passes an `available` row, we filter it.
        { id: 'bt_x', status: 'available', net: 99999, currency: 'usd', available_on: APR_30 } as unknown as Stripe.BalanceTransaction,
      ],
      now: NOW,
    });
    expect(r.pending_settlement_breakdown).toHaveLength(1);
    expect(r.pending_settlement_breakdown[0].amount).toBe(500);
  });

  it('multi-currency pending_settlement_breakdown sorts deterministically (date asc, then currency asc)', () => {
    const r = accountBalance({
      balance: balance(
        [{ amount: 100000, currency: 'usd' }],
        [{ amount: 100000, currency: 'usd' }],
      ),
      pendingTransactions: [
        pendingTxn(50000, 'usd', APR_30),
        pendingTxn(20000, 'cad', APR_30),
        pendingTxn(30000, 'usd', MAY_01),
      ],
      now: NOW,
    });
    expect(r.pending_settlement_breakdown).toHaveLength(3);
    // 2026-04-30 cad first (alphabetical within same date), then 2026-04-30 usd, then 2026-05-01 usd.
    expect(r.pending_settlement_breakdown[0]).toMatchObject({
      available_on: '2026-04-30',
      currency: 'cad',
    });
    expect(r.pending_settlement_breakdown[1]).toMatchObject({
      available_on: '2026-04-30',
      currency: 'usd',
    });
    expect(r.pending_settlement_breakdown[2]).toMatchObject({
      available_on: '2026-05-01',
      currency: 'usd',
    });
  });

  it('empty pending → empty breakdown, but pending array still surfaced', () => {
    const r = accountBalance({
      balance: balance(
        [{ amount: 100000, currency: 'usd' }],
        [{ amount: 50000, currency: 'usd' }],
      ),
      pendingTransactions: [],
      now: NOW,
    });
    expect(r.pending).toEqual([{ currency: 'usd', amount: 500 }]);
    expect(r.pending_settlement_breakdown).toEqual([]);
  });

  it('all-empty Stripe balance returns empty arrays (not null) for available/pending', () => {
    const r = accountBalance({
      balance: balance([], []),
      pendingTransactions: [],
      now: NOW,
    });
    expect(r.available).toEqual([]);
    expect(r.pending).toEqual([]);
    expect(r.instant_available).toBeNull();
  });
});
