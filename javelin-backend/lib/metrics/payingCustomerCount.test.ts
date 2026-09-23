import { describe, it, expect } from 'vitest';
import { payingCustomerCount } from './payingCustomerCount';
import type { StripeChargeLike } from './chargeEnriched';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const MARCH_2026 = {
  start: Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};

const MAR_05 = Math.floor(Date.UTC(2026, 2, 5, 0, 0, 0) / 1000);
const MAR_15 = Math.floor(Date.UTC(2026, 2, 15, 0, 0, 0) / 1000);
const MAR_25 = Math.floor(Date.UTC(2026, 2, 25, 0, 0, 0) / 1000);
const FEB_15 = Math.floor(Date.UTC(2026, 1, 15, 0, 0, 0) / 1000);

function charge(
  id: string,
  customer: string | null,
  status: 'succeeded' | 'pending' | 'failed',
  created: number,
  amount = 10000,
  fraud: 'user' | 'stripe' | null = null,
): StripeChargeLike {
  return {
    id,
    customer,
    amount,
    amount_refunded: 0,
    currency: 'usd',
    status,
    created,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    fraud_details:
      fraud === 'user'
        ? { user_report: 'fraudulent', stripe_report: null }
        : fraud === 'stripe'
          ? { user_report: null, stripe_report: 'fraudulent' }
          : null,
  };
}

describe('paying_customer_count', () => {
  it('counts distinct customer IDs', () => {
    const r = payingCustomerCount({
      charges: [
        charge('a', 'cus_1', 'succeeded', MAR_05),
        charge('b', 'cus_2', 'succeeded', MAR_15),
        charge('c', 'cus_1', 'succeeded', MAR_25), // duplicate customer
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.value).toBe(2);
    expect(r.with_customer_record).toBe(2);
    expect(r.guest_payments).toBe(0);
    expect(r.charge_count).toBe(3);
  });

  it('guest payments counted per-charge (no dedup)', () => {
    const r = payingCustomerCount({
      charges: [
        charge('a', null, 'succeeded', MAR_05),
        charge('b', null, 'succeeded', MAR_15),
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.value).toBe(2);
    expect(r.with_customer_record).toBe(0);
    expect(r.guest_payments).toBe(2);
  });

  it('mixed identified + guest', () => {
    const r = payingCustomerCount({
      charges: [
        charge('a', 'cus_1', 'succeeded', MAR_05),
        charge('b', null, 'succeeded', MAR_15),
        charge('c', 'cus_1', 'succeeded', MAR_25), // dedup
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.value).toBe(2); // 1 identified + 1 guest
    expect(r.with_customer_record).toBe(1);
    expect(r.guest_payments).toBe(1);
  });

  it('excludes non-succeeded charges', () => {
    const r = payingCustomerCount({
      charges: [
        charge('a', 'cus_1', 'succeeded', MAR_05),
        charge('b', 'cus_2', 'failed', MAR_15),
        charge('c', 'cus_3', 'pending', MAR_25),
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.value).toBe(1);
    expect(r.charge_count).toBe(1);
  });

  it('date filter excludes out-of-period', () => {
    const r = payingCustomerCount({
      charges: [
        charge('a', 'cus_1', 'succeeded', MAR_15),
        charge('b', 'cus_2', 'succeeded', FEB_15),
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.value).toBe(1);
  });

  it('empty input → all zeros', () => {
    const r = payingCustomerCount({
      charges: [],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.value).toBe(0);
    expect(r.with_customer_record).toBe(0);
    expect(r.guest_payments).toBe(0);
    expect(r.charge_count).toBe(0);
  });

  it('customer as object with id (Stripe expansion form)', () => {
    const r = payingCustomerCount({
      charges: [
        { ...charge('a', null, 'succeeded', MAR_05), customer: { id: 'cus_x' } },
        { ...charge('b', null, 'succeeded', MAR_15), customer: { id: 'cus_x' } }, // dedup
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.value).toBe(1);
    expect(r.with_customer_record).toBe(1);
  });

  describe('exclude_fraud', () => {
    it('default false — fraud charges counted', () => {
      const r = payingCustomerCount({
        charges: [
          charge('a', 'cus_1', 'succeeded', MAR_05),
          charge('b', 'cus_2', 'succeeded', MAR_15, 10000, 'user'),
        ],
        period: MARCH_2026,
        now: NOW,
      });
      expect(r.value).toBe(2);
      expect(r.charge_count).toBe(2);
      expect(r.fraud_excluded_charges).toBe(0);
    });

    it('true — drops fraud charges and reports the count', () => {
      const r = payingCustomerCount({
        charges: [
          charge('a', 'cus_1', 'succeeded', MAR_05),
          charge('b', 'cus_2', 'succeeded', MAR_15, 10000, 'user'),
          charge('c', 'cus_3', 'succeeded', MAR_25, 10000, 'stripe'),
        ],
        period: MARCH_2026,
        now: NOW,
        excludeFraud: true,
      });
      expect(r.value).toBe(1);
      expect(r.with_customer_record).toBe(1);
      expect(r.charge_count).toBe(1);
      expect(r.fraud_excluded_charges).toBe(2);
    });

    it('true — keeps customer when they have a non-fraud charge', () => {
      const r = payingCustomerCount({
        charges: [
          charge('a', 'cus_1', 'succeeded', MAR_05),
          charge('b', 'cus_1', 'succeeded', MAR_15, 10000, 'user'), // same customer, fraud
        ],
        period: MARCH_2026,
        now: NOW,
        excludeFraud: true,
      });
      expect(r.value).toBe(1);
      expect(r.fraud_excluded_charges).toBe(1);
    });
  });

  it('output envelope: scalar kind, count unit, definition + as_of + period', () => {
    const r = payingCustomerCount({
      charges: [],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.kind).toBe('scalar');
    expect(r.unit).toBe('count');
    expect(r.definition).toBe('javelin_defined.paying_customer_count');
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.period).toEqual(MARCH_2026);
  });
});
