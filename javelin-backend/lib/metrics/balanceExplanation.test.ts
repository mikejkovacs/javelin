import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { balanceExplanation } from './balanceExplanation';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const APRIL_2026 = {
  start: Math.floor(Date.UTC(2026, 3, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 3, 30, 23, 59, 59) / 1000),
};

const APR_05 = Math.floor(Date.UTC(2026, 3, 5, 0, 0, 0) / 1000);
const APR_10 = Math.floor(Date.UTC(2026, 3, 10, 0, 0, 0) / 1000);
const APR_15 = Math.floor(Date.UTC(2026, 3, 15, 0, 0, 0) / 1000);
const MAR_15 = Math.floor(Date.UTC(2026, 2, 15, 0, 0, 0) / 1000); // out of period

/** Build a balance_transaction. `amount` defaults to net+fee for charges. */
function bt(opts: {
  amount?: number;
  net: number;
  fee?: number;
  reporting_category: string | null;
  created: number;
  currency?: string;
}): Stripe.BalanceTransaction {
  const fee = opts.fee ?? 0;
  return {
    id: `bt_${Math.random().toString(36).slice(2, 8)}`,
    amount: opts.amount ?? opts.net + fee,
    net: opts.net,
    fee,
    reporting_category: opts.reporting_category,
    currency: opts.currency ?? 'usd',
    created: opts.created,
  } as unknown as Stripe.BalanceTransaction;
}

describe('balance_explanation', () => {
  it('groups activity by reporting_category (gross amount) and synthesizes a fee row from per-row .fee', () => {
    const r = balanceExplanation({
      transactions: [
        // 2 charges with processing fees inlined
        bt({ net: 97000, fee: 3000, reporting_category: 'charge', created: APR_05 }), // amount $1,000, fee $30
        bt({ net: 48500, fee: 1500, reporting_category: 'charge', created: APR_10 }), // amount $500, fee $15
        // 1 refund (no fee)
        bt({ amount: -10000, net: -10000, reporting_category: 'refund', created: APR_10 }),
        // 1 payout (excluded from activity, no synthetic fee from it)
        bt({ amount: -250000, net: -250000, reporting_category: 'payout', created: APR_15 }),
      ],
      startingBalanceByCurrency: { usd: 1000 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const usd = r.blocks[0];
    expect(usd.starting_balance).toBe(1000);
    expect(usd.payouts).toEqual({ count: 1, total: 2500 });
    // Activity rows: charge $1,500 (gross) / refund -$100 / fee -$45 (synthetic)
    expect(usd.activity).toHaveLength(3);
    const byCat = Object.fromEntries(usd.activity.map((a) => [a.category, a]));
    expect(byCat.charge).toEqual({ category: 'charge', amount: 1500, count: 2 });
    expect(byCat.refund).toEqual({ category: 'refund', amount: -100, count: 1 });
    expect(byCat.fee).toEqual({ category: 'fee', amount: -45, count: 2 });
    // Reconciliation: net_activity = 1500 - 100 - 45 = 1355
    expect(usd.net_activity).toBe(1355);
    // ending = 1000 + 1355 - 2500 = -145
    expect(usd.ending_balance).toBe(-145);
  });

  it('merges standalone reporting_category=fee BTs with synthesized per-row fees into one fee row', () => {
    const r = balanceExplanation({
      transactions: [
        // Charge with $30 inlined processing fee (synthesized into fee row)
        bt({ net: 97000, fee: 3000, reporting_category: 'charge', created: APR_05 }),
        // Standalone Stripe fee BT — e.g. monthly subscription fee
        bt({ amount: -200, net: -200, fee: 0, reporting_category: 'fee', created: APR_10 }),
      ],
      startingBalanceByCurrency: { usd: 1000 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const fee = r.blocks[0].activity.find((a) => a.category === 'fee')!;
    // Standalone -$2 + synthesized -$30 = -$32, count 1 standalone + 1 charge-with-fee = 2
    expect(fee.amount).toBe(-32);
    expect(fee.count).toBe(2);
    // Reconciliation: charge $1,000 - $32 fees - 0 payouts; ending = 1000 + 968 = 1968
    expect(r.blocks[0].net_activity).toBe(968);
    expect(r.blocks[0].ending_balance).toBe(1968);
  });

  it('does not synthesize a fee row when no non-payout txn had a fee', () => {
    const r = balanceExplanation({
      transactions: [
        bt({ amount: 50000, net: 50000, reporting_category: 'charge', created: APR_05 }),
      ],
      startingBalanceByCurrency: { usd: 0 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const cats = r.blocks[0].activity.map((a) => a.category);
    expect(cats).toEqual(['charge']);
    expect(r.blocks[0].activity[0].amount).toBe(500);
  });

  it('payout fees do NOT contribute to the synthetic activity-fee row', () => {
    const r = balanceExplanation({
      transactions: [
        bt({ amount: -100000, net: -100100, fee: 100, reporting_category: 'payout', created: APR_15 }),
      ],
      startingBalanceByCurrency: { usd: 1000 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.blocks[0].activity).toEqual([]);
    expect(r.blocks[0].payouts.count).toBe(1);
  });

  it('filters out-of-period transactions', () => {
    const r = balanceExplanation({
      transactions: [
        bt({ amount: 50000, net: 50000, reporting_category: 'charge', created: APR_05 }),
        bt({ amount: 99999, net: 99999, reporting_category: 'charge', created: MAR_15 }),
      ],
      startingBalanceByCurrency: { usd: 0 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.blocks[0].activity).toHaveLength(1);
    expect(r.blocks[0].activity[0].count).toBe(1);
    expect(r.blocks[0].activity[0].amount).toBe(500);
  });

  it('per-currency block; no cross-currency summing', () => {
    const r = balanceExplanation({
      transactions: [
        bt({ amount: 100000, net: 100000, reporting_category: 'charge', created: APR_05, currency: 'usd' }),
        bt({ amount: 200000, net: 200000, reporting_category: 'charge', created: APR_10, currency: 'cad' }),
      ],
      startingBalanceByCurrency: { usd: 500, cad: 1500 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.blocks).toHaveLength(2);
    const cad = r.blocks.find((b) => b.currency === 'cad')!;
    const usd = r.blocks.find((b) => b.currency === 'usd')!;
    expect(cad.starting_balance).toBe(1500);
    expect(cad.net_activity).toBe(2000);
    expect(cad.ending_balance).toBe(3500);
    expect(usd.starting_balance).toBe(500);
    expect(usd.net_activity).toBe(1000);
    expect(usd.ending_balance).toBe(1500);
  });

  it('unknown reporting_category falls through to "other"', () => {
    const r = balanceExplanation({
      transactions: [
        bt({ amount: 50000, net: 50000, reporting_category: 'charge', created: APR_05 }),
        bt({ amount: -2000, net: -2000, reporting_category: 'climate_order_purchase', created: APR_10 }),
        bt({ amount: -500, net: -500, reporting_category: null, created: APR_15 }),
      ],
      startingBalanceByCurrency: { usd: 0 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const other = r.blocks[0].activity.find((a) => a.category === 'other')!;
    expect(other.count).toBe(2);
    expect(other.amount).toBe(-25);
  });

  it('ending_balance reconciliation: starting + net_activity − payouts.total', () => {
    const r = balanceExplanation({
      transactions: [
        bt({ amount: 100000, net: 100000, reporting_category: 'charge', created: APR_05 }),
        bt({ amount: -50000, net: -50000, reporting_category: 'payout', created: APR_15 }),
      ],
      startingBalanceByCurrency: { usd: 200 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const usd = r.blocks[0];
    expect(usd.net_activity).toBe(1000);
    expect(usd.payouts.total).toBe(500);
    expect(usd.ending_balance).toBe(700);
  });

  it('currency with starting balance but no in-period activity still surfaces a block', () => {
    const r = balanceExplanation({
      transactions: [
        bt({ amount: 50000, net: 50000, reporting_category: 'charge', created: APR_05, currency: 'usd' }),
      ],
      startingBalanceByCurrency: { usd: 100, cad: 250 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const cad = r.blocks.find((b) => b.currency === 'cad')!;
    expect(cad.starting_balance).toBe(250);
    expect(cad.activity).toEqual([]);
    expect(cad.net_activity).toBe(0);
    expect(cad.payouts).toEqual({ count: 0, total: 0 });
    expect(cad.ending_balance).toBe(250);
  });

  it('multiple payouts sum into payouts.total and payouts.count', () => {
    const r = balanceExplanation({
      transactions: [
        bt({ amount: -100000, net: -100000, reporting_category: 'payout', created: APR_05 }),
        bt({ amount: -150000, net: -150000, reporting_category: 'payout', created: APR_15 }),
      ],
      startingBalanceByCurrency: { usd: 3000 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.blocks[0].payouts).toEqual({ count: 2, total: 2500 });
    expect(r.blocks[0].activity).toEqual([]);
    expect(r.blocks[0].ending_balance).toBe(500);
  });

  it('activity sorted by |amount| descending', () => {
    const r = balanceExplanation({
      transactions: [
        bt({ amount: 100000, net: 99000, fee: 1000, reporting_category: 'charge', created: APR_10 }),
        bt({ amount: -30000, net: -30000, reporting_category: 'refund', created: APR_15 }),
      ],
      startingBalanceByCurrency: { usd: 0 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const cats = r.blocks[0].activity.map((a) => a.category);
    // charge $1000 > refund $300 > fee $10 (synthesized from $1,000 charge fee)
    expect(cats).toEqual(['charge', 'refund', 'fee']);
  });

  it('truncated flag passes through; definition + as_of populated', () => {
    const r = balanceExplanation({
      transactions: [],
      startingBalanceByCurrency: {},
      period: APRIL_2026,
      now: NOW,
      truncated: true,
    });
    expect(r.truncated).toBe(true);
    expect(r.definition).toBe('stripe_canonical.balance_summary');
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.blocks).toEqual([]);
  });

  it('zero-decimal currency (jpy) divides by 1', () => {
    const r = balanceExplanation({
      transactions: [
        bt({ amount: 12345, net: 12345, reporting_category: 'charge', created: APR_05, currency: 'jpy' }),
      ],
      startingBalanceByCurrency: { jpy: 5000 },
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.blocks[0].activity[0].amount).toBe(12345);
    expect(r.blocks[0].ending_balance).toBe(17345);
  });
});
