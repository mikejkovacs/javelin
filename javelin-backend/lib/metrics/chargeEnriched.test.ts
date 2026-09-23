// Fixture-based tests for charge_enriched.
// Covers: money conversion, BT join, nullable BT, card/billing fallback, envelope.

import { describe, it, expect } from 'vitest';
import {
  chargeEnriched,
  type StripeChargeLike,
  type StripeBalanceTransactionLike,
} from './chargeEnriched';

const NOW = new Date(Date.UTC(2026, 3, 16, 12, 0, 0)); // 2026-04-16T12:00:00Z
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

// ── Fixture builders ─────────────────────────────────────────────────────────

type ChargeOverrides = {
  id?: string;
  customer?: string | null;
  amount?: number;
  amount_refunded?: number;
  currency?: string;
  status?: 'succeeded' | 'pending' | 'failed';
  created?: number;
  disputed?: boolean;
  refunded?: boolean;
  balance_transaction?: string | null;
  card_brand?: string | null;
  card_country?: string | null;
  billing_country?: string | null;
  no_pmd?: boolean;
  no_billing?: boolean;
  fraud_user_report?: string | null;
  fraud_stripe_report?: string | null;
  no_fraud_details?: boolean;
};

function makeCharge(o: ChargeOverrides = {}): StripeChargeLike {
  return {
    id: o.id ?? 'ch_test',
    customer: o.customer === undefined ? 'cus_test' : o.customer,
    amount: o.amount ?? 10000,
    amount_refunded: o.amount_refunded ?? 0,
    currency: o.currency ?? 'usd',
    status: o.status ?? 'succeeded',
    created: o.created ?? NOW_SEC - 3600,
    disputed: o.disputed ?? false,
    refunded: o.refunded ?? false,
    balance_transaction: o.balance_transaction === undefined ? 'txn_test' : o.balance_transaction,
    payment_method_details: o.no_pmd
      ? null
      : {
          card: {
            brand: o.card_brand === undefined ? 'visa' : o.card_brand,
            country: o.card_country === undefined ? 'US' : o.card_country,
          },
        },
    billing_details: o.no_billing
      ? null
      : {
          address: {
            country: o.billing_country === undefined ? 'US' : o.billing_country,
          },
        },
    fraud_details: o.no_fraud_details
      ? null
      : {
          user_report:
            o.fraud_user_report === undefined ? null : o.fraud_user_report,
          stripe_report:
            o.fraud_stripe_report === undefined ? null : o.fraud_stripe_report,
        },
  };
}

type BtOverrides = {
  id?: string;
  fee?: number;
  net?: number;
  currency?: string;
  type?: string;
  created?: number;
};

function makeBt(o: BtOverrides = {}): StripeBalanceTransactionLike {
  return {
    id: o.id ?? 'txn_test',
    fee: o.fee ?? 59,
    net: o.net ?? 9941,
    currency: o.currency ?? 'usd',
    type: o.type ?? 'charge',
    created: o.created ?? NOW_SEC - 3600,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('chargeEnriched — money conversion', () => {
  it('converts amount/amount_refunded to major units', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ amount: 12345, amount_refunded: 500 })],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.rows[0].amount).toBeCloseTo(123.45, 5);
    expect(result.rows[0].amount_refunded).toBeCloseTo(5.0, 5);
    expect(result.rows[0].net_collected).toBeCloseTo(118.45, 5);
  });

  it('handles zero-decimal currency (JPY)', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ amount: 1000, amount_refunded: 100, currency: 'jpy' })],
      balanceTransactions: [makeBt({ currency: 'jpy', fee: 30, net: 970 })],
      now: NOW,
    });
    expect(result.rows[0].amount).toBe(1000);
    expect(result.rows[0].amount_refunded).toBe(100);
    expect(result.rows[0].net_collected).toBe(900);
    expect(result.rows[0].fee).toBe(30);
    expect(result.rows[0].net).toBe(970);
  });

  it('handles three-decimal currency (BHD)', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ amount: 12345, currency: 'bhd' })],
      balanceTransactions: [makeBt({ currency: 'bhd', fee: 100, net: 12245 })],
      now: NOW,
    });
    expect(result.rows[0].amount).toBeCloseTo(12.345, 5);
    expect(result.rows[0].fee).toBeCloseTo(0.1, 5);
  });
});

describe('chargeEnriched — balance_transaction join', () => {
  it('joins fee/net from matching BT', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ balance_transaction: 'txn_A' })],
      balanceTransactions: [makeBt({ id: 'txn_A', fee: 75, net: 9925 })],
      now: NOW,
    });
    expect(result.rows[0].fee).toBeCloseTo(0.75, 5);
    expect(result.rows[0].net).toBeCloseTo(99.25, 5);
  });

  it('returns null fee/net when charge has no balance_transaction', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ balance_transaction: null, status: 'pending' })],
      balanceTransactions: [],
      now: NOW,
    });
    expect(result.rows[0].fee).toBeNull();
    expect(result.rows[0].net).toBeNull();
  });

  it('returns null fee/net when BT not in co-fetched set (tail of window)', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ balance_transaction: 'txn_missing' })],
      balanceTransactions: [makeBt({ id: 'txn_unrelated' })],
      now: NOW,
    });
    expect(result.rows[0].fee).toBeNull();
    expect(result.rows[0].net).toBeNull();
  });

  it('uses BT currency for fee/net conversion on cross-currency charges', () => {
    // Charge in EUR but settled in USD (hypothetical cross-currency scenario).
    const result = chargeEnriched({
      charges: [makeCharge({ amount: 10000, currency: 'eur' })],
      balanceTransactions: [makeBt({ fee: 59, net: 10500, currency: 'usd' })],
      now: NOW,
    });
    expect(result.rows[0].currency).toBe('eur');
    expect(result.rows[0].amount).toBeCloseTo(100, 5);
    expect(result.rows[0].fee).toBeCloseTo(0.59, 5);
    expect(result.rows[0].net).toBeCloseTo(105.0, 5);
  });
});

describe('chargeEnriched — customer & nullables', () => {
  it('expands string customer id', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ customer: 'cus_ABC' })],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.rows[0].customer_id).toBe('cus_ABC');
  });

  it('returns null customer_id when charge has no customer', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ customer: null })],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.rows[0].customer_id).toBeNull();
  });

  it('returns nulls when payment_method_details absent', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ no_pmd: true })],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.rows[0].card_brand).toBeNull();
    expect(result.rows[0].card_country).toBeNull();
  });

  it('returns null billing_country when billing_details absent', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ no_billing: true })],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.rows[0].billing_country).toBeNull();
  });
});

describe('chargeEnriched — is_fraudulent', () => {
  it('is true when user_report = fraudulent', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ fraud_user_report: 'fraudulent' })],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.rows[0].is_fraudulent).toBe(true);
  });

  it('is true when stripe_report = fraudulent', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ fraud_stripe_report: 'fraudulent' })],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.rows[0].is_fraudulent).toBe(true);
  });

  it('is false when neither report is fraudulent', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ fraud_user_report: 'safe' })],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.rows[0].is_fraudulent).toBe(false);
  });

  it('is false when fraud_details absent', () => {
    const result = chargeEnriched({
      charges: [makeCharge({ no_fraud_details: true })],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.rows[0].is_fraudulent).toBe(false);
  });
});

describe('chargeEnriched — output envelope', () => {
  it('returns empty rows for empty input', () => {
    const result = chargeEnriched({ charges: [], balanceTransactions: [], now: NOW });
    expect(result.rows).toEqual([]);
    expect(result.kind).toBe('rows');
  });

  it('sets definition and as_of', () => {
    const result = chargeEnriched({
      charges: [makeCharge()],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.definition).toBe('javelin.charge_enriched.v1');
    expect(result.as_of).toBe(NOW_SEC);
    expect(result.kind).toBe('rows');
  });

  it('preserves row order from input', () => {
    const result = chargeEnriched({
      charges: [
        makeCharge({ id: 'ch_1' }),
        makeCharge({ id: 'ch_2' }),
        makeCharge({ id: 'ch_3' }),
      ],
      balanceTransactions: [makeBt()],
      now: NOW,
    });
    expect(result.rows.map((r) => r.charge_id)).toEqual(['ch_1', 'ch_2', 'ch_3']);
  });
});
