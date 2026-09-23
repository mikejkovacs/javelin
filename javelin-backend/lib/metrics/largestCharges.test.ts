import { describe, it, expect } from 'vitest';
import { largestCharges } from './largestCharges';
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
    card_brand: null,
    card_country: null,
    billing_country: null,
    disputed: o.disputed ?? false,
    refunded: o.refunded ?? false,
    fee: 3,
    net: 97,
    is_fraudulent: o.is_fraudulent ?? false,
  };
}

function makeCust(
  id: string,
  name: string | null = null,
  email: string | null = null,
): CustomerRollupRow {
  return {
    customer_id: id,
    name,
    email,
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

describe('largestCharges', () => {
  it('empty input → empty rows', () => {
    const r = largestCharges({
      charges: [],
      customers: [],
      period: PERIOD,
      default_currency: 'usd',
      n: 5,
      now: NOW,
    });
    expect(r.rows).toEqual([]);
    expect(r.currency).toBe('usd');
    expect(r.definition).toBe('javelin_defined.largest_charges_in_period');
  });

  it('orders by net_collected desc, top-N truncation', () => {
    const charges = [
      makeCharge({ charge_id: 'ch_small', net_collected: 50, customer_id: 'a' }),
      makeCharge({ charge_id: 'ch_big', net_collected: 500, customer_id: 'b' }),
      makeCharge({ charge_id: 'ch_mid', net_collected: 200, customer_id: 'c' }),
    ];
    const r = largestCharges({
      charges,
      customers: [makeCust('a'), makeCust('b'), makeCust('c')],
      period: PERIOD,
      default_currency: 'usd',
      n: 2,
      now: NOW,
    });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].charge_id).toBe('ch_big');
    expect(r.rows[0].rank).toBe(1);
    expect(r.rows[1].charge_id).toBe('ch_mid');
    expect(r.rows[1].rank).toBe(2);
  });

  it('refunded charge ranks at net_collected (post-refund), not gross', () => {
    const charges = [
      makeCharge({
        charge_id: 'ch_refunded',
        amount: 1000,
        amount_refunded: 950,
        net_collected: 50,
        refunded: true,
        customer_id: 'a',
      }),
      makeCharge({ charge_id: 'ch_clean', net_collected: 100, customer_id: 'b' }),
    ];
    const r = largestCharges({
      charges,
      customers: [makeCust('a'), makeCust('b')],
      period: PERIOD,
      default_currency: 'usd',
      n: 5,
      now: NOW,
    });
    expect(r.rows[0].charge_id).toBe('ch_clean');
    expect(r.rows[1].charge_id).toBe('ch_refunded');
    expect(r.rows[1].refunded).toBe(true);
    expect(r.rows[1].amount).toBe(50);
  });

  it('display_name falls through name → email → unnamed', () => {
    const charges = [
      makeCharge({ charge_id: 'ch_named', customer_id: 'named' }),
      makeCharge({ charge_id: 'ch_email', customer_id: 'email_only' }),
      makeCharge({ charge_id: 'ch_anon', customer_id: 'no_id' }),
    ];
    const r = largestCharges({
      charges,
      customers: [
        makeCust('named', 'Acme Corp'),
        makeCust('email_only', null, 'foo@bar.com'),
        makeCust('no_id'),
      ],
      period: PERIOD,
      default_currency: 'usd',
      n: 5,
      now: NOW,
    });
    const byId = new Map(r.rows.map((row) => [row.charge_id, row]));
    expect(byId.get('ch_named')!.customer_display_name).toBe('Acme Corp');
    expect(byId.get('ch_email')!.customer_display_name).toBe('foo@bar.com');
    expect(byId.get('ch_anon')!.customer_display_name).toBe('an unnamed customer');
  });

  it('null customer_id → "an unnamed customer"', () => {
    const r = largestCharges({
      charges: [makeCharge({ charge_id: 'ch_anon', customer_id: null })],
      customers: [],
      period: PERIOD,
      default_currency: 'usd',
      n: 5,
      now: NOW,
    });
    expect(r.rows[0].customer_id).toBeNull();
    expect(r.rows[0].customer_display_name).toBe('an unnamed customer');
  });

  it('filters out non-default currency, non-succeeded, out-of-period', () => {
    const charges = [
      makeCharge({ charge_id: 'ch_keep', net_collected: 100 }),
      makeCharge({ charge_id: 'ch_currency', net_collected: 200, currency: 'cad' }),
      makeCharge({ charge_id: 'ch_failed', net_collected: 300, status: 'failed' }),
      makeCharge({
        charge_id: 'ch_old',
        net_collected: 400,
        created_at: PERIOD.start - 86400,
      }),
    ];
    const r = largestCharges({
      charges,
      customers: [makeCust('cus_test')],
      period: PERIOD,
      default_currency: 'usd',
      n: 5,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].charge_id).toBe('ch_keep');
  });

  it('ties on amount tie-break by created_at desc', () => {
    const charges = [
      makeCharge({
        charge_id: 'ch_older',
        net_collected: 100,
        created_at: NOW_SEC - 86400 * 5,
      }),
      makeCharge({
        charge_id: 'ch_newer',
        net_collected: 100,
        created_at: NOW_SEC - 86400 * 1,
      }),
    ];
    const r = largestCharges({
      charges,
      customers: [makeCust('cus_test')],
      period: PERIOD,
      default_currency: 'usd',
      n: 5,
      now: NOW,
    });
    expect(r.rows[0].charge_id).toBe('ch_newer');
    expect(r.rows[1].charge_id).toBe('ch_older');
  });

  it('occurred_at_iso renders as YYYY-MM-DD', () => {
    const charges = [
      makeCharge({
        charge_id: 'ch_dated',
        created_at: Math.floor(
          new Date('2026-04-15T10:30:00Z').getTime() / 1000,
        ),
      }),
    ];
    const r = largestCharges({
      charges,
      customers: [makeCust('cus_test')],
      period: PERIOD,
      default_currency: 'usd',
      n: 5,
      now: NOW,
    });
    expect(r.rows[0].occurred_at_iso).toBe('2026-04-15');
  });
});
