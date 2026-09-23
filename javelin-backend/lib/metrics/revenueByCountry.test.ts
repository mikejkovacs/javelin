import { describe, it, expect } from 'vitest';
import { revenueByCountry } from './revenueByCountry';
import type { StripeChargeLike } from './chargeEnriched';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));

const MARCH_2026 = {
  start: Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};

const MAR_05 = Math.floor(Date.UTC(2026, 2, 5, 0, 0, 0) / 1000);
const FEB_15 = Math.floor(Date.UTC(2026, 1, 15, 0, 0, 0) / 1000);

function charge(
  id: string,
  amount_minor: number,
  card_country: string | null,
  currency = 'usd',
  amount_refunded = 0,
  created = MAR_05,
  status: 'succeeded' | 'failed' = 'succeeded',
): StripeChargeLike {
  return {
    id,
    customer: 'cus_x',
    amount: amount_minor,
    amount_refunded,
    currency,
    status,
    created,
    disputed: false,
    refunded: false,
    balance_transaction: null,
    payment_method_details: card_country
      ? { card: { country: card_country, brand: 'visa' } }
      : null,
  };
}

describe('revenue_by_country', () => {
  it('groups charges by (country, currency) tuple', () => {
    const r = revenueByCountry({
      charges: [
        charge('a', 100000, 'US'), // $1,000 US/USD
        charge('b', 50000, 'US'),  // $500 US/USD
        charge('c', 30000, 'CA'),  // $300 CA/USD
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(2);
    // Sort: USD has higher total → US row first within USD block
    expect(r.rows[0].country).toBe('US');
    expect(r.rows[0].currency).toBe('usd');
    expect(r.rows[0].amount).toBe(1500);
    expect(r.rows[0].charge_count).toBe(2);
    expect(r.rows[1].country).toBe('CA');
    expect(r.rows[1].currency).toBe('usd');
    expect(r.rows[1].amount).toBe(300);
    expect(r.totals_by_currency).toEqual({ usd: 1800 });
  });

  it('multi-currency: sorts by currency-block dominance, then by amount within block', () => {
    const r = revenueByCountry({
      charges: [
        charge('a', 50000, 'US', 'usd'),    // $500 US/USD
        charge('b', 200000, 'CA', 'cad'),   // CA$2,000 CA/CAD ← biggest currency block
        charge('c', 100000, 'CA', 'cad'),   // CA$1,000 CA/CAD
        charge('d', 12000, 'GB', 'gbp'),    // £120 GB/GBP
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(3);
    // CAD is largest minor-unit total (300000) → comes first
    expect(r.rows[0].currency).toBe('cad');
    expect(r.rows[0].country).toBe('CA');
    expect(r.rows[0].amount).toBe(3000);
    expect(r.rows[0].charge_count).toBe(2);
    // USD next (50000)
    expect(r.rows[1].currency).toBe('usd');
    expect(r.rows[1].country).toBe('US');
    expect(r.rows[1].amount).toBe(500);
    // GBP last (12000)
    expect(r.rows[2].currency).toBe('gbp');
    expect(r.rows[2].country).toBe('GB');
    expect(r.rows[2].amount).toBe(120);
    expect(r.totals_by_currency).toEqual({ cad: 3000, usd: 500, gbp: 120 });
  });

  it('charges with null card_country bucket as "unknown"', () => {
    const r = revenueByCountry({
      charges: [
        charge('a', 100000, 'US'),
        charge('b', 50000, null),
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(2);
    const unknown = r.rows.find((row) => row.country === 'unknown');
    expect(unknown?.amount).toBe(500);
    expect(unknown?.currency).toBe('usd');
  });

  it('share is computed within currency, not across currencies', () => {
    const r = revenueByCountry({
      charges: [
        charge('a', 75000, 'US', 'usd'),  // $750 → 75% of USD total
        charge('b', 25000, 'CA', 'usd'),  // $250 → 25% of USD total
        charge('c', 100000, 'CA', 'cad'), // CA$1,000 → 100% of CAD total
      ],
      period: MARCH_2026,
      now: NOW,
    });
    const us = r.rows.find((row) => row.country === 'US' && row.currency === 'usd');
    const caUsd = r.rows.find((row) => row.country === 'CA' && row.currency === 'usd');
    const caCad = r.rows.find((row) => row.country === 'CA' && row.currency === 'cad');
    expect(us?.share).toBeCloseTo(0.75, 5);
    expect(caUsd?.share).toBeCloseTo(0.25, 5);
    expect(caCad?.share).toBeCloseTo(1.0, 5);
  });

  it('refunds reduce the row amount; fully-refunded charges drop out', () => {
    const r = revenueByCountry({
      charges: [
        charge('a', 100000, 'US', 'usd', 30000), // $1,000 - $300 = $700 net
        charge('b', 50000, 'US', 'usd', 50000),  // fully refunded → drop
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].amount).toBe(700);
    expect(r.rows[0].charge_count).toBe(1);
  });

  it('skips failed charges and out-of-period charges', () => {
    const r = revenueByCountry({
      charges: [
        charge('a', 100000, 'US', 'usd', 0, MAR_05, 'failed'), // failed
        charge('b', 50000, 'US', 'usd', 0, FEB_15),            // out of period
        charge('c', 30000, 'US', 'usd', 0, MAR_05),            // valid
      ],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].amount).toBe(300);
  });

  it('empty input → empty rows + empty totals', () => {
    const r = revenueByCountry({
      charges: [],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.rows).toHaveLength(0);
    expect(r.totals_by_currency).toEqual({});
  });

  it('definition tag is set correctly', () => {
    const r = revenueByCountry({
      charges: [],
      period: MARCH_2026,
      now: NOW,
    });
    expect(r.definition).toBe('javelin_defined.revenue_by_country');
  });

  // ── Phase 2C — series mode ──────────────────────────────────────────────
  describe('series mode', () => {
    const APR_15 = Math.floor(Date.UTC(2026, 3, 15, 0, 0, 0) / 1000);
    const Q1_2026 = {
      start: Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000),
      end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
    };

    it('granularity=month → groups carry per-bucket series', () => {
      const r = revenueByCountry({
        charges: [
          charge('a', 100000, 'US', 'usd', 0, MAR_05),  // $1,000 US/USD March
          charge('b', 50000, 'US', 'usd', 0, FEB_15),   // $500 US/USD Feb
          charge('c', 200000, 'CA', 'cad', 0, MAR_05),  // CA$2,000 CA/CAD March
        ],
        period: Q1_2026,
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.granularity).toBe('month');
      expect(r.buckets).toEqual(['2026-01', '2026-02', '2026-03']);
      // Sort: CAD has higher minor total (200000 > 150000) → first
      expect(r.groups[0]).toMatchObject({
        country: 'CA',
        currency: 'cad',
        total: 2000,
        charge_count: 1,
      });
      expect(r.groups[0].series.map((p) => p.amount)).toEqual([0, 0, 2000]);
      // US/USD second
      expect(r.groups[1]).toMatchObject({ country: 'US', currency: 'usd', total: 1500 });
      expect(r.groups[1].series.map((p) => p.amount)).toEqual([0, 500, 1000]);
      expect(r.totals_by_currency).toEqual({ cad: 2000, usd: 1500 });
    });

    it('granularity=week → ISO Monday-start, dense across empty weeks', () => {
      const r = revenueByCountry({
        charges: [charge('a', 100000, 'US', 'usd', 0, MAR_05)], // Thu of 2026-03-02 week
        period: MARCH_2026,
        now: NOW,
        granularity: 'week',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.buckets).toEqual([
        '2026-02-23',
        '2026-03-02',
        '2026-03-09',
        '2026-03-16',
        '2026-03-23',
        '2026-03-30',
      ]);
      expect(r.groups[0].series.map((p) => p.amount)).toEqual([0, 1000, 0, 0, 0, 0]);
    });

    it('multi-currency series → groups bucket-aligned, no FX', () => {
      const r = revenueByCountry({
        charges: [
          charge('a', 100000, 'US', 'usd', 0, MAR_05),
          charge('b', 200000, 'CA', 'cad', 0, APR_15),  // out of period
        ],
        period: MARCH_2026,
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.groups).toHaveLength(1);
      expect(r.groups[0].country).toBe('US');
      expect(r.totals_by_currency).toEqual({ usd: 1000 });
    });

    it('null card_country → group as "unknown" in series too', () => {
      const r = revenueByCountry({
        charges: [
          charge('a', 100000, 'US', 'usd', 0, MAR_05),
          charge('b', 50000, null, 'usd', 0, MAR_05),
        ],
        period: MARCH_2026,
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      const unknown = r.groups.find((g) => g.country === 'unknown');
      expect(unknown?.total).toBe(500);
    });

    it('refunds reduce per-bucket amount; fully-refunded drops out', () => {
      const r = revenueByCountry({
        charges: [
          charge('a', 100000, 'US', 'usd', 30000, MAR_05),  // $700 net
          charge('b', 50000, 'US', 'usd', 50000, MAR_05),   // fully refunded → drop
        ],
        period: MARCH_2026,
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.groups[0].total).toBe(700);
      expect(r.groups[0].charge_count).toBe(1);
      expect(r.groups[0].series[0].amount).toBe(700);
    });

    it('empty period → empty groups, dense buckets still emitted', () => {
      const r = revenueByCountry({
        charges: [],
        period: Q1_2026,
        now: NOW,
        granularity: 'month',
      });
      if (r.kind !== 'series') throw new Error('expected series');
      expect(r.groups).toHaveLength(0);
      expect(r.buckets).toEqual(['2026-01', '2026-02', '2026-03']);
      expect(r.totals_by_currency).toEqual({});
    });
  });
});
