import { describe, it, expect } from 'vitest';
import { projectRevenue } from './projectRevenue';
import type { MonthlyAmount } from '../profile/types';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0)); // 2026-04-29

function series(
  amounts: number[],
  startMonth = '2025-05',
  currency = 'usd',
): MonthlyAmount[] {
  const [yStr, mStr] = startMonth.split('-');
  let year = parseInt(yStr, 10);
  let month = parseInt(mStr, 10);
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

describe('project_revenue', () => {
  it('compounds current_value forward by horizon_months at the avg_growth_rate', () => {
    // 7 monthly points → 6 MoM rates ≈ 10% each → avg 0.10
    const r = projectRevenue({
      series: series([100, 110, 121, 133.1, 146.41, 161.05, 177.16]),
      metric: 'recurring_revenue',
      lookback_months: 6,
      horizon_months: 3,
      now: NOW,
    });
    expect(r.current_value).toBeCloseTo(177.16, 2);
    expect(r.monthly_growth_rate).toBeCloseTo(0.10, 2);
    // 177.16 × 1.10^3 ≈ 235.79
    expect(r.projected_value).toBeGreaterThan(230);
    expect(r.projected_value).toBeLessThan(240);
  });

  it('passes through trend_label from growth_rate', () => {
    const r = projectRevenue({
      series: series([460, 430, 430, 450, 430, 430, 400]),
      metric: 'direct_charge_revenue',
      lookback_months: 6,
      horizon_months: 6,
      now: NOW,
    });
    expect(r.trend_label).toBe('declining');
    expect(r.monthly_growth_rate).toBeLessThan(0);
    // Declining projection — projected_value should be lower than current
    expect(r.projected_value).toBeLessThan(r.current_value);
  });

  it('current_month is the last month in the trailing window', () => {
    const r = projectRevenue({
      series: series(
        [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210],
        '2025-05',
      ),
      metric: 'billed_revenue',
      lookback_months: 6,
      horizon_months: 3,
      now: NOW,
    });
    // 12 months supplied starting 2025-05 → last is 2026-04
    expect(r.current_month).toBe('2026-04');
  });

  it('projected_month is current_month + horizon_months', () => {
    const r = projectRevenue({
      series: series([100, 110, 120, 130, 140, 150, 160], '2025-10'),
      metric: 'recurring_revenue',
      lookback_months: 6,
      horizon_months: 6,
      now: NOW,
    });
    // last month = 2026-04; +6 → 2026-10
    expect(r.current_month).toBe('2026-04');
    expect(r.projected_month).toBe('2026-10');
  });

  it('horizon spanning year boundary rolls month correctly', () => {
    const r = projectRevenue({
      series: series([100, 110, 120, 130, 140, 150, 160], '2025-10'),
      metric: 'recurring_revenue',
      lookback_months: 6,
      horizon_months: 12,
      now: NOW,
    });
    // 2026-04 + 12 → 2027-04
    expect(r.projected_month).toBe('2027-04');
  });

  it('horizon=1 returns next-month projection', () => {
    // 7 monthly points → ~10% MoM growth, avg ≈ 0.10
    const r = projectRevenue({
      series: series([100, 110, 121, 133.1, 146.41, 161.05, 177.16]),
      metric: 'recurring_revenue',
      lookback_months: 6,
      horizon_months: 1,
      now: NOW,
    });
    expect(r.projected_value).toBeCloseTo(177.16 * 1.10, 1);
  });

  it('empty series → sparse coverage, zeros, projected_month falls back to now', () => {
    const r = projectRevenue({
      series: [],
      metric: 'recurring_revenue',
      lookback_months: 6,
      horizon_months: 3,
      now: NOW,
    });
    expect(r.coverage).toBe('sparse');
    expect(r.current_value).toBe(0);
    expect(r.projected_value).toBe(0);
    expect(r.trend_label).toBe('flat');
  });

  it('undefined series (profile lacks the field) → sparse', () => {
    const r = projectRevenue({
      series: undefined,
      metric: 'billed_revenue',
      lookback_months: 6,
      horizon_months: 3,
      now: NOW,
    });
    expect(r.coverage).toBe('sparse');
    expect(r.current_value).toBe(0);
  });

  it('preserves currency from input series', () => {
    const r = projectRevenue({
      series: series([1000, 1010, 1020, 1030, 1040, 1050, 1060], '2025-10', 'cad'),
      metric: 'recurring_revenue',
      lookback_months: 6,
      horizon_months: 3,
      now: NOW,
    });
    expect(r.currency).toBe('cad');
  });

  it('definition tag set correctly', () => {
    const r = projectRevenue({
      series: series([100, 110]),
      metric: 'billed_revenue',
      lookback_months: 2,
      horizon_months: 1,
      now: NOW,
    });
    expect(r.definition).toBe('javelin_defined.project_revenue');
  });

  it('window echoed in result', () => {
    const r = projectRevenue({
      series: series([100, 110, 120, 130, 140, 150, 160]),
      metric: 'recurring_revenue',
      lookback_months: 6,
      horizon_months: 3,
      now: NOW,
    });
    expect(r.window.lookback_months).toBe(6);
    expect(r.window.horizon_months).toBe(3);
  });

  it('lookback_months controls trailing window passed to growth_rate', () => {
    // 12 months supplied. With lookback_months=3, trailing window+1 = 4 points.
    // The earliest 8 months are ignored; rate is computed only over the last 4.
    const longSeries = series(
      [100, 100, 100, 100, 100, 100, 100, 100, 100, 200, 300, 400],
      '2025-05',
    );
    const r = projectRevenue({
      series: longSeries,
      metric: 'recurring_revenue',
      lookback_months: 3,
      horizon_months: 1,
      now: NOW,
    });
    // Last 4 points: 100, 200, 300, 400 → rates 100%, 50%, 33% → avg ~61%
    // Last value = 400. Projection = 400 × 1.61 ≈ 644.
    expect(r.current_value).toBe(400);
    expect(r.monthly_growth_rate).toBeGreaterThan(0.5);
    expect(r.projected_value).toBeGreaterThan(600);
  });

  it('passes through l1_state_mrr when metric=recurring_revenue (Path A+)', () => {
    const r = projectRevenue({
      series: series([100, 110, 120, 130, 140, 150, 160]),
      metric: 'recurring_revenue',
      lookback_months: 6,
      horizon_months: 3,
      now: NOW,
      l1_state_mrr: 200,
    });
    expect(r.current_l1_state_mrr).toBe(200);
  });

  it('omits current_l1_state_mrr for non-recurring metrics even if l1 mrr provided', () => {
    const r = projectRevenue({
      series: series([100, 110, 120, 130, 140, 150, 160]),
      metric: 'billed_revenue',
      lookback_months: 6,
      horizon_months: 3,
      now: NOW,
      l1_state_mrr: 200,
    });
    expect(r.current_l1_state_mrr).toBeUndefined();
  });

  it('omits current_l1_state_mrr when l1_state_mrr not provided', () => {
    const r = projectRevenue({
      series: series([100, 110, 120, 130, 140, 150, 160]),
      metric: 'recurring_revenue',
      lookback_months: 6,
      horizon_months: 3,
      now: NOW,
    });
    expect(r.current_l1_state_mrr).toBeUndefined();
  });

  it('flat trend on a slowly-growing series', () => {
    // ~2% MoM rates, half-diff small → flat
    const r = projectRevenue({
      series: series([1000, 1020, 1040, 1060, 1080, 1100, 1120]),
      metric: 'billed_revenue',
      lookback_months: 6,
      horizon_months: 3,
      now: NOW,
    });
    expect(r.trend_label).toBe('flat');
    expect(r.monthly_growth_rate).toBeGreaterThan(0);
    expect(r.projected_value).toBeGreaterThan(r.current_value);
  });
});
