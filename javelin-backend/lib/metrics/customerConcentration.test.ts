import { describe, it, expect } from 'vitest';
import { customerConcentration } from './customerConcentration';
import type { ChargeEnrichedRow } from './chargeEnriched';
import type { CustomerRollupRow } from './customerRollup';

const NOW = new Date(Date.UTC(2026, 3, 22, 12, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const PERIOD = { start: NOW_SEC - 86400 * 30, end: NOW_SEC };

function makeCharge(o: Partial<ChargeEnrichedRow> = {}): ChargeEnrichedRow {
  return {
    charge_id: o.charge_id ?? 'ch_test',
    customer_id: o.customer_id === undefined ? 'cus_test' : o.customer_id,
    amount: o.amount ?? 100,
    amount_refunded: o.amount_refunded ?? 0,
    net_collected: o.net_collected ?? 100,
    currency: o.currency ?? 'usd',
    status: o.status ?? 'succeeded',
    created_at: o.created_at ?? NOW_SEC - 86400,
    card_brand: o.card_brand === undefined ? 'visa' : o.card_brand,
    card_country: o.card_country === undefined ? 'US' : o.card_country,
    billing_country: o.billing_country === undefined ? null : o.billing_country,
    disputed: o.disputed ?? false,
    refunded: o.refunded ?? false,
    fee: o.fee === undefined ? 3 : o.fee,
    net: o.net === undefined ? 97 : o.net,
    is_fraudulent: o.is_fraudulent ?? false,
  };
}

function makeCust(id: string, name: string | null = null): CustomerRollupRow {
  return {
    customer_id: id,
    name,
    email: null,
    card_country: null,
    created_at: NOW_SEC - 86400 * 365,
    first_charge_at: null,
    last_charge_at: null,
    lifetime_collected: 0,
    lifetime_collected_currency: null,
    current_mrr: 0,
    mrr_currency: null,
    subscriptions: [],
    subscription_count: 0,
  };
}

describe('customerConcentration', () => {
  it('empty input → all zeros, no top_1_customer', () => {
    const r = customerConcentration({
      charges: [],
      customers: [],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.top_1_share).toBe(0);
    expect(r.value.top_5_share).toBe(0);
    expect(r.value.top_10_share).toBe(0);
    expect(r.value.top_1_customer).toBeNull();
    expect(r.rows).toEqual([]);
    expect(r.total_collected).toBe(0);
  });

  it('single customer = 100% concentration', () => {
    const r = customerConcentration({
      charges: [makeCharge({ customer_id: 'cus_a', net_collected: 1000 })],
      customers: [makeCust('cus_a', 'Acme')],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.top_1_share).toBe(1);
    expect(r.value.top_1_customer).toEqual({
      id: 'cus_a',
      name: 'Acme',
      email: null,
      display_name: 'Acme',
      amount: 1000,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toEqual({
      rank: 1,
      customer_id: 'cus_a',
      name: 'Acme',
      email: null,
      display_name: 'Acme',
      amount: 1000,
      share: 1,
    });
  });

  it('ranks by amount desc; share sums to 1 across all customers', () => {
    const r = customerConcentration({
      charges: [
        makeCharge({ charge_id: 'c1', customer_id: 'cus_a', net_collected: 100 }),
        makeCharge({ charge_id: 'c2', customer_id: 'cus_b', net_collected: 300 }),
        makeCharge({ charge_id: 'c3', customer_id: 'cus_c', net_collected: 200 }),
      ],
      customers: [makeCust('cus_a'), makeCust('cus_b'), makeCust('cus_c')],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.rows.map((x) => x.customer_id)).toEqual(['cus_b', 'cus_c', 'cus_a']);
    expect(r.value.top_1_share).toBeCloseTo(0.5, 5);    // 300/600
    expect(r.value.top_5_share).toBeCloseTo(1, 5);       // all three fit
    expect(r.value.top_10_share).toBeCloseTo(1, 5);
    expect(r.total_collected).toBe(600);
  });

  it('aggregates multiple charges per customer', () => {
    const r = customerConcentration({
      charges: [
        makeCharge({ charge_id: 'c1', customer_id: 'cus_a', net_collected: 100 }),
        makeCharge({ charge_id: 'c2', customer_id: 'cus_a', net_collected: 50 }),
        makeCharge({ charge_id: 'c3', customer_id: 'cus_b', net_collected: 200 }),
      ],
      customers: [makeCust('cus_a'), makeCust('cus_b')],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.top_1_customer?.id).toBe('cus_b');
    expect(r.rows.find((x) => x.customer_id === 'cus_a')?.amount).toBe(150);
  });

  it('excludes failed/pending charges', () => {
    const r = customerConcentration({
      charges: [
        makeCharge({ charge_id: 'c1', customer_id: 'cus_a', net_collected: 100, status: 'failed' }),
        makeCharge({ charge_id: 'c2', customer_id: 'cus_a', net_collected: 50, status: 'succeeded' }),
      ],
      customers: [makeCust('cus_a')],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.total_collected).toBe(50);
  });

  it('excludes charges outside the period', () => {
    const r = customerConcentration({
      charges: [
        makeCharge({ customer_id: 'cus_a', net_collected: 100, created_at: PERIOD.start - 1 }),
        makeCharge({ customer_id: 'cus_a', net_collected: 50, created_at: PERIOD.start + 100 }),
        makeCharge({ customer_id: 'cus_a', net_collected: 25, created_at: PERIOD.end + 1 }),
      ],
      customers: [makeCust('cus_a')],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.total_collected).toBe(50);
  });

  it('excludes charges in non-default currencies (M2.3-S4)', () => {
    const r = customerConcentration({
      charges: [
        makeCharge({ customer_id: 'cus_a', currency: 'usd', net_collected: 100 }),
        makeCharge({ customer_id: 'cus_b', currency: 'eur', net_collected: 9999 }),
      ],
      customers: [makeCust('cus_a'), makeCust('cus_b')],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.total_collected).toBe(100);
    expect(r.rows.map((x) => x.customer_id)).toEqual(['cus_a']);
  });

  it('default_currency is normalized to lowercase', () => {
    const r = customerConcentration({
      charges: [makeCharge({ customer_id: 'cus_a', currency: 'usd', net_collected: 100 })],
      customers: [makeCust('cus_a')],
      period: PERIOD,
      default_currency: 'USD',
      now: NOW,
    });
    expect(r.currency).toBe('usd');
    expect(r.total_collected).toBe(100);
  });

  it('excludes charges with null customer_id', () => {
    const r = customerConcentration({
      charges: [
        makeCharge({ customer_id: null, net_collected: 999 }),
        makeCharge({ customer_id: 'cus_a', net_collected: 100 }),
      ],
      customers: [makeCust('cus_a')],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.total_collected).toBe(100);
    expect(r.rows).toHaveLength(1);
  });

  it('rows capped at top-10', () => {
    const charges: ChargeEnrichedRow[] = [];
    const customers: CustomerRollupRow[] = [];
    for (let i = 0; i < 15; i++) {
      charges.push(makeCharge({ charge_id: `c${i}`, customer_id: `cus_${i}`, net_collected: 100 + i }));
      customers.push(makeCust(`cus_${i}`));
    }
    const r = customerConcentration({
      charges,
      customers,
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.rows).toHaveLength(10);
    expect(r.rows[0].rank).toBe(1);
    expect(r.rows[9].rank).toBe(10);
    // top is largest customer (cus_14, $114)
    expect(r.rows[0].customer_id).toBe('cus_14');
  });

  it('top_5 / top_10 shares with mixed customer count', () => {
    const charges: ChargeEnrichedRow[] = [];
    const customers: CustomerRollupRow[] = [];
    // 7 customers, equal $100 each → total $700, top_1=1/7, top_5=5/7, top_10=7/7
    for (let i = 0; i < 7; i++) {
      charges.push(makeCharge({ charge_id: `c${i}`, customer_id: `cus_${i}`, net_collected: 100 }));
      customers.push(makeCust(`cus_${i}`));
    }
    const r = customerConcentration({
      charges,
      customers,
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.top_1_share).toBeCloseTo(1 / 7, 5);
    expect(r.value.top_5_share).toBeCloseTo(5 / 7, 5);
    expect(r.value.top_10_share).toBeCloseTo(1, 5);
  });

  it('name lookup from rollup; null name when customer not in lookup', () => {
    const r = customerConcentration({
      charges: [
        makeCharge({ customer_id: 'cus_a', net_collected: 100 }),
        makeCharge({ customer_id: 'cus_orphan', net_collected: 50 }),
      ],
      customers: [makeCust('cus_a', 'Acme')],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.rows.find((x) => x.customer_id === 'cus_a')?.name).toBe('Acme');
    expect(r.rows.find((x) => x.customer_id === 'cus_orphan')?.name).toBeNull();
  });

  it('display_name fallback: name when present, email when name is null, generic placeholder when both null', () => {
    const namedCustomer = makeCust('cus_named', 'Acme Corp');
    const emailOnlyCustomer: CustomerRollupRow = {
      ...makeCust('cus_email_only'),
      email: 'user@example.com',
    };
    const anonymousCustomer = makeCust('cus_anon');
    const r = customerConcentration({
      charges: [
        makeCharge({ charge_id: 'c1', customer_id: 'cus_named', net_collected: 300 }),
        makeCharge({ charge_id: 'c2', customer_id: 'cus_email_only', net_collected: 200 }),
        makeCharge({ charge_id: 'c3', customer_id: 'cus_anon', net_collected: 100 }),
      ],
      customers: [namedCustomer, emailOnlyCustomer, anonymousCustomer],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    const named = r.rows.find((x) => x.customer_id === 'cus_named');
    const emailOnly = r.rows.find((x) => x.customer_id === 'cus_email_only');
    const anonymous = r.rows.find((x) => x.customer_id === 'cus_anon');
    expect(named?.display_name).toBe('Acme Corp');
    expect(emailOnly?.display_name).toBe('user@example.com');
    expect(anonymous?.display_name).toBe('an unnamed customer');
    // top_1_customer (cus_named) also gets email + display_name fields
    expect(r.value.top_1_customer?.email).toBeNull();
    expect(r.value.top_1_customer?.display_name).toBe('Acme Corp');
  });

  it('envelope: kind, definition, unit, period, currency, total_collected', () => {
    const r = customerConcentration({
      charges: [makeCharge({ customer_id: 'cus_a', net_collected: 100 })],
      customers: [makeCust('cus_a')],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.kind).toBe('scalar');
    expect(r.definition).toBe('javelin_defined.customer_concentration');
    expect(r.unit).toBe('percent');
    expect(r.period).toEqual(PERIOD);
    expect(r.currency).toBe('usd');
    expect(r.total_collected).toBe(100);
    expect(r.as_of).toBe(NOW_SEC);
  });
});
