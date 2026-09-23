import { describe, it, expect } from 'vitest';
import { customerSpendDistribution } from './customerSpendDistribution';
import type { ChargeEnrichedRow } from './chargeEnriched';

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
    disputed: false,
    refunded: false,
    fee: 3,
    net: 97,
    is_fraudulent: false,
  };
}

/** Synthesize charges where each customer's id encodes their period total. */
function chargesFromTotals(totalsByCustomer: number[]): ChargeEnrichedRow[] {
  return totalsByCustomer.map((amount, i) =>
    makeCharge({
      charge_id: `ch_${i}`,
      customer_id: `cus_${i}`,
      net_collected: amount,
    }),
  );
}

describe('customerSpendDistribution', () => {
  it('empty input → all null stats, count 0, low_sample true', () => {
    const r = customerSpendDistribution({
      charges: [],
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.median).toBeNull();
    expect(r.value.p25).toBeNull();
    expect(r.value.p75).toBeNull();
    expect(r.value.p90).toBeNull();
    expect(r.value.mean).toBeNull();
    expect(r.value.paying_customer_count).toBe(0);
    expect(r.value.total_collected).toBe(0);
    expect(r.value.low_sample).toBe(true);
  });

  it('odd-count median = strict middle element', () => {
    // 5 customers: 100, 200, 300, 400, 500 → sorted, middle = 300
    const r = customerSpendDistribution({
      charges: chargesFromTotals([100, 200, 300, 400, 500]),
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.median).toBe(300);
    expect(r.value.paying_customer_count).toBe(5);
  });

  it('even-count median = average of two middles', () => {
    // 4 customers: 100, 200, 300, 400 → avg of 200 and 300 = 250
    const r = customerSpendDistribution({
      charges: chargesFromTotals([100, 200, 300, 400]),
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.median).toBe(250);
    expect(r.value.paying_customer_count).toBe(4);
  });

  it('mean ≠ median for skewed distribution', () => {
    // Top-heavy: 10, 10, 10, 10, 10000 → median 10, mean 2008
    const r = customerSpendDistribution({
      charges: chargesFromTotals([10, 10, 10, 10, 10000]),
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.median).toBe(10);
    expect(r.value.mean).toBeCloseTo(2008, 0);
  });

  it('p25, p75, p90 by nearest-rank on a 100-customer fixture', () => {
    // Customer i has amount (i+1) * 10 → totals 10, 20, ... 1000
    const totals = Array.from({ length: 100 }, (_, i) => (i + 1) * 10);
    const r = customerSpendDistribution({
      charges: chargesFromTotals(totals),
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.p25).toBe(250); // ceil(0.25 * 100) = 25 → array[24] = 250
    expect(r.value.median).toBe(505); // even count: (500+510)/2
    expect(r.value.p75).toBe(750); // ceil(0.75 * 100) = 75 → array[74] = 750
    expect(r.value.p90).toBe(900); // ceil(0.90 * 100) = 90 → array[89] = 900
  });

  it('low_sample flag = true for count < 5, false for count ≥ 5', () => {
    const small = customerSpendDistribution({
      charges: chargesFromTotals([100, 200, 300, 400]),
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(small.value.low_sample).toBe(true);

    const big = customerSpendDistribution({
      charges: chargesFromTotals([100, 200, 300, 400, 500]),
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(big.value.low_sample).toBe(false);
  });

  it('groups multiple charges per customer into single per-customer total', () => {
    const charges: ChargeEnrichedRow[] = [
      makeCharge({ charge_id: 'ch1', customer_id: 'cus_a', net_collected: 100 }),
      makeCharge({ charge_id: 'ch2', customer_id: 'cus_a', net_collected: 200 }),
      makeCharge({ charge_id: 'ch3', customer_id: 'cus_b', net_collected: 50 }),
    ];
    const r = customerSpendDistribution({
      charges,
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    // cus_a total = 300, cus_b total = 50 → median = (300+50)/2 = 175
    expect(r.value.paying_customer_count).toBe(2);
    expect(r.value.median).toBe(175);
  });

  it('excludes failed, non-default-currency, out-of-period, null-customer charges', () => {
    const charges: ChargeEnrichedRow[] = [
      makeCharge({ charge_id: 'keep', customer_id: 'a', net_collected: 100 }),
      makeCharge({
        charge_id: 'failed',
        customer_id: 'b',
        net_collected: 999,
        status: 'failed',
      }),
      makeCharge({
        charge_id: 'cad',
        customer_id: 'c',
        net_collected: 999,
        currency: 'cad',
      }),
      makeCharge({
        charge_id: 'old',
        customer_id: 'd',
        net_collected: 999,
        created_at: PERIOD.start - 86400,
      }),
      makeCharge({ charge_id: 'no_cust', customer_id: null, net_collected: 999 }),
    ];
    const r = customerSpendDistribution({
      charges,
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.paying_customer_count).toBe(1);
    expect(r.value.total_collected).toBe(100);
  });

  it('top_1_share + bottom_50_share computed from sorted totals', () => {
    // 4 customers totaling 1000: [100, 200, 300, 400]. Top-1 = 400 → 40%.
    // Bottom 50% (2 smallest) = 100 + 200 = 300 → 30%.
    const r = customerSpendDistribution({
      charges: chargesFromTotals([100, 200, 300, 400]),
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.top_1_share).toBeCloseTo(0.4, 5);
    expect(r.value.bottom_50_share).toBeCloseTo(0.3, 5);
  });

  it('single customer → low_sample, median = total, percentiles all = total', () => {
    const r = customerSpendDistribution({
      charges: chargesFromTotals([1000]),
      period: PERIOD,
      default_currency: 'usd',
      now: NOW,
    });
    expect(r.value.median).toBe(1000);
    expect(r.value.p25).toBe(1000);
    expect(r.value.p90).toBe(1000);
    expect(r.value.low_sample).toBe(true);
  });
});
