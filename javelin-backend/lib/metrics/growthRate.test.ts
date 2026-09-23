import { describe, it, expect } from 'vitest';
import { growthRate } from './growthRate';
import type { MonthlyAmount } from '../profile/types';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));

function series(
  amounts: number[],
  startMonth = '2025-05',
  currency = 'usd',
): MonthlyAmount[] {
  // Generate consecutive months starting from startMonth.
  const [startYearStr, startMonthStr] = startMonth.split('-');
  let year = parseInt(startYearStr, 10);
  let month = parseInt(startMonthStr, 10);
  return amounts.map((amount) => {
    const m = `${year}-${String(month).padStart(2, '0')}`;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    return { month: m, amount, currency };
  });
}

describe('growth_rate', () => {
  it('computes MoM growth for trailing window+1 months (window=6 → 7 data points → 6 rates)', () => {
    const r = growthRate({
      series: series([100, 110, 120, 130, 140, 150, 160]),
      metric: 'recurring_revenue',
      window: 6,
      now: NOW,
    });
    expect(r.rows).toHaveLength(7);
    expect(r.rows[0].growth_rate).toBeNull(); // first row has no prior
    expect(r.rows[1].growth_rate).toBeCloseTo(0.1, 4);    // 110/100 - 1
    expect(r.rows[2].growth_rate).toBeCloseTo(0.0909, 3); // 120/110 - 1
    // avg of 6 rates roughly 0.0905 (consistent linear-add MoM rates)
    expect(r.avg_growth_rate).toBeGreaterThan(0.075);
    expect(r.avg_growth_rate).toBeLessThan(0.105);
    expect(r.coverage).toBe('full');
  });

  it('declining trend when avg growth is negative', () => {
    const r = growthRate({
      series: series([460, 430, 430, 450, 430, 430, 400]),
      metric: 'direct_charge_revenue',
      window: 6,
      now: NOW,
    });
    expect(r.avg_growth_rate).toBeLessThan(0);
    expect(r.trend_label).toBe('declining');
  });

  it('accelerating trend when 2nd-half avg exceeds 1st-half avg by >5pp', () => {
    // 1st half rates: ~1%, 2nd half rates: ~7% → diff ~6pp
    const r = growthRate({
      series: series([1000, 1010, 1020, 1030, 1100, 1180, 1260]),
      metric: 'recurring_revenue',
      window: 6,
      now: NOW,
    });
    expect(r.avg_growth_rate).toBeGreaterThan(0);
    expect(r.trend_label).toBe('accelerating');
  });

  it('decelerating trend when 1st-half avg exceeds 2nd-half avg by >5pp (both nonneg)', () => {
    // 1st half rates: ~7%, 2nd half rates: ~1% → diff -6pp; avg still positive
    const r = growthRate({
      series: series([1000, 1070, 1145, 1225, 1240, 1255, 1270]),
      metric: 'billed_revenue',
      window: 6,
      now: NOW,
    });
    expect(r.avg_growth_rate).toBeGreaterThan(0);
    expect(r.trend_label).toBe('decelerating');
  });

  it('flat trend when avg ≥ 0 and half-difference is within ±5pp', () => {
    // All rates roughly 2% → diff near 0
    const r = growthRate({
      series: series([1000, 1020, 1040, 1060, 1080, 1100, 1120]),
      metric: 'billed_revenue',
      window: 6,
      now: NOW,
    });
    expect(r.trend_label).toBe('flat');
  });

  it('null growth rate when prior period is zero (division by zero protection)', () => {
    const r = growthRate({
      series: series([0, 100, 110, 120, 130, 140, 150]),
      metric: 'recurring_revenue',
      window: 6,
      now: NOW,
    });
    // Row 0: null (no prior). Row 1: null (prior was 0). Rows 2-6: valid rates.
    expect(r.rows[0].growth_rate).toBeNull();
    expect(r.rows[1].growth_rate).toBeNull();
    expect(r.rows[2].growth_rate).not.toBeNull();
    // 1 of 6 growth rates is null → not >50% → coverage stays 'full'
    expect(r.coverage).toBe('full');
  });

  it('sparse coverage when >50% of growth rates are null', () => {
    const r = growthRate({
      series: series([0, 0, 0, 0, 100, 110, 120]),
      metric: 'recurring_revenue',
      window: 6,
      now: NOW,
    });
    // 4 of 6 rates are null (>50%) → sparse
    expect(r.coverage).toBe('sparse');
  });

  it('partial coverage when fewer than window+1 data points available', () => {
    const r = growthRate({
      series: series([100, 110, 120]),
      metric: 'recurring_revenue',
      window: 6,
      now: NOW,
    });
    expect(r.coverage).toBe('partial');
    expect(r.rows).toHaveLength(3); // still emits all available
  });

  it('empty series → sparse coverage, no rows', () => {
    const r = growthRate({
      series: [],
      metric: 'recurring_revenue',
      window: 6,
      now: NOW,
    });
    expect(r.rows).toHaveLength(0);
    expect(r.coverage).toBe('sparse');
    expect(r.trend_label).toBe('flat');
  });

  it('undefined series (profile lacks the field) → sparse coverage', () => {
    const r = growthRate({
      series: undefined,
      metric: 'recurring_revenue',
      window: 6,
      now: NOW,
    });
    expect(r.rows).toHaveLength(0);
    expect(r.coverage).toBe('sparse');
  });

  it('takes trailing window+1 from a longer series', () => {
    // 12 months supplied, window=6 → take last 7
    const r = growthRate({
      series: series(
        [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210],
      ),
      metric: 'recurring_revenue',
      window: 6,
      now: NOW,
    });
    expect(r.rows).toHaveLength(7);
    expect(r.rows[0].metric_value).toBe(150); // 6th month back from last
    expect(r.rows[6].metric_value).toBe(210); // last month
  });

  it('definition tag set correctly', () => {
    const r = growthRate({
      series: series([100, 110]),
      metric: 'billed_revenue',
      window: 1,
      now: NOW,
    });
    expect(r.definition).toBe('javelin_defined.growth_rate');
  });

  it('preserves currency from input series', () => {
    const r = growthRate({
      series: series([1000, 1010], '2025-05', 'cad'),
      metric: 'recurring_revenue',
      window: 1,
      now: NOW,
    });
    expect(r.currency).toBe('cad');
  });
});
