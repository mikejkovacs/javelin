import { describe, it, expect } from 'vitest';
import { goalEta } from './goalEta';
import type { Distribution, MonthlyAmount } from '../profile/types';

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

function dist(median: number, nMonths = 6): Distribution {
  return { min: Math.max(1, median - 5), median, max: median + 10, n_months: nMonths };
}

describe('goal_eta — revenue metrics', () => {
  it('reachable target with compounding growth', () => {
    // 7 monthly points → ~10% MoM, current = 177.16, target 250
    // months = ceil(log(250/177.16) / log(1.10)) = ceil(3.6) = 4
    const r = goalEta({
      metric: 'recurring_revenue',
      target_value: 250,
      series: series([100, 110, 121, 133.1, 146.41, 161.05, 177.16]),
      lookback_months: 6,
      now: NOW,
    });
    expect(r.state).toBe('reachable');
    if (r.state === 'reachable') {
      expect(r.months_to_target).toBe(4);
      // last month of series = 2025-05 + 6 = 2025-11; +4 = 2026-03
      expect(r.target_eta_iso).toBe('2026-03');
    }
  });

  it('already-achieved branch finds crossover month in series', () => {
    // Series 100→160; target 130 first met at month index 3 (130)
    const r = goalEta({
      metric: 'recurring_revenue',
      target_value: 130,
      series: series([100, 110, 120, 130, 140, 150, 160]),
      lookback_months: 6,
      now: NOW,
    });
    expect(r.state).toBe('achieved');
    if (r.state === 'achieved') {
      // start 2025-05; index 3 = 2025-08
      expect(r.achieved_at_iso).toBe('2025-08');
    }
  });

  it('already-achieved at start of window when target < first value', () => {
    const r = goalEta({
      metric: 'recurring_revenue',
      target_value: 50,
      series: series([100, 110, 120, 130, 140, 150, 160]),
      lookback_months: 6,
      now: NOW,
    });
    expect(r.state).toBe('achieved');
    if (r.state === 'achieved') {
      expect(r.achieved_at_iso).toBe('2025-05'); // first month of trailing window
    }
  });

  it('unreachable declining when rate < 0 and target > current', () => {
    const r = goalEta({
      metric: 'direct_charge_revenue',
      target_value: 600,
      series: series([460, 430, 430, 450, 430, 430, 400]),
      lookback_months: 6,
      now: NOW,
    });
    expect(r.state).toBe('unreachable');
    if (r.state === 'unreachable') {
      expect(r.unreachable_reason).toBe('declining');
      expect(r.months_required).toBeNull();
    }
  });

  it('unreachable flat when rate = 0 and target > current', () => {
    const r = goalEta({
      metric: 'recurring_revenue',
      target_value: 200,
      series: series([100, 100, 100, 100, 100, 100, 100]),
      lookback_months: 6,
      now: NOW,
    });
    expect(r.state).toBe('unreachable');
    if (r.state === 'unreachable') {
      expect(r.unreachable_reason).toBe('flat');
    }
  });

  it('unreachable too_distant when months > MAX_HORIZON (60)', () => {
    // ~1% MoM → log(100x)/log(1.01) ≈ 462 months for 100x growth
    const r = goalEta({
      metric: 'recurring_revenue',
      target_value: 1000000,
      series: series([1000, 1010, 1020, 1030, 1040, 1050, 1060]),
      lookback_months: 6,
      now: NOW,
    });
    expect(r.state).toBe('unreachable');
    if (r.state === 'unreachable') {
      expect(r.unreachable_reason).toBe('too_distant');
      expect(r.months_required).toBeGreaterThan(60);
    }
  });

  it('sparse series → unreachable flat', () => {
    const r = goalEta({
      metric: 'recurring_revenue',
      target_value: 1000,
      series: [],
      lookback_months: 6,
      now: NOW,
    });
    expect(r.state).toBe('unreachable');
    if (r.state === 'unreachable') {
      expect(r.unreachable_reason).toBe('flat');
    }
  });

  it('preserves currency on revenue answer', () => {
    const r = goalEta({
      metric: 'recurring_revenue',
      target_value: 1500,
      series: series([1000, 1010, 1020, 1030, 1040, 1050, 1060], '2025-10', 'cad'),
      lookback_months: 6,
      now: NOW,
    });
    expect(r.currency).toBe('cad');
  });

  it('definition tag set correctly (revenue)', () => {
    const r = goalEta({
      metric: 'billed_revenue',
      target_value: 2000,
      series: series([1000, 1100, 1200, 1300, 1400, 1500, 1600]),
      lookback_months: 6,
      now: NOW,
    });
    expect(r.definition).toBe('javelin_defined.goal_eta');
  });

  it('passes through l1_state_mrr when metric=recurring_revenue (Path A+)', () => {
    const r = goalEta({
      metric: 'recurring_revenue',
      target_value: 1500,
      series: series([1000, 1010, 1020, 1030, 1040, 1050, 1060]),
      lookback_months: 6,
      now: NOW,
      l1_state_mrr: 1200,
    });
    expect(r.current_l1_state_mrr).toBe(1200);
  });

  it('omits current_l1_state_mrr for non-recurring revenue metrics', () => {
    const r = goalEta({
      metric: 'billed_revenue',
      target_value: 2000,
      series: series([1000, 1100, 1200, 1300, 1400, 1500, 1600]),
      lookback_months: 6,
      now: NOW,
      l1_state_mrr: 1200,
    });
    expect(r.current_l1_state_mrr).toBeUndefined();
  });

  it('omits current_l1_state_mrr when l1_state_mrr not provided', () => {
    const r = goalEta({
      metric: 'recurring_revenue',
      target_value: 1500,
      series: series([1000, 1010, 1020, 1030, 1040, 1050, 1060]),
      lookback_months: 6,
      now: NOW,
    });
    expect(r.current_l1_state_mrr).toBeUndefined();
  });

  it('window includes max_horizon_months = 60', () => {
    const r = goalEta({
      metric: 'recurring_revenue',
      target_value: 200,
      series: series([100, 110, 120, 130, 140, 150, 160]),
      lookback_months: 6,
      now: NOW,
    });
    expect(r.window.max_horizon_months).toBe(60);
  });
});

describe('goal_eta — customer_count metric', () => {
  it('reachable target with linear growth', () => {
    // current 312, net 14, target 400 → ceil((400-312)/14) = ceil(6.3) = 7
    const r = goalEta({
      metric: 'customer_count',
      target_value: 400,
      current_count: 312,
      new_customer_distribution: dist(18),
      churn_distribution: dist(4),
      now: NOW,
    });
    expect(r.state).toBe('reachable');
    if (r.state === 'reachable') {
      expect(r.months_to_target).toBe(7);
      // 2026-04 + 7 = 2026-11
      expect(r.target_eta_iso).toBe('2026-11');
    }
  });

  it('achieved when target ≤ current_count, achieved_at_iso null (no series)', () => {
    const r = goalEta({
      metric: 'customer_count',
      target_value: 200,
      current_count: 312,
      new_customer_distribution: dist(18),
      churn_distribution: dist(4),
      now: NOW,
    });
    expect(r.state).toBe('achieved');
    if (r.state === 'achieved') {
      expect(r.achieved_at_iso).toBeNull();
    }
  });

  it('unreachable declining when net < 0 and target > current', () => {
    const r = goalEta({
      metric: 'customer_count',
      target_value: 200,
      current_count: 100,
      new_customer_distribution: dist(2),
      churn_distribution: dist(8),
      now: NOW,
    });
    expect(r.state).toBe('unreachable');
    if (r.state === 'unreachable') {
      expect(r.unreachable_reason).toBe('declining');
    }
  });

  it('unreachable flat when net = 0 and target > current', () => {
    const r = goalEta({
      metric: 'customer_count',
      target_value: 200,
      current_count: 100,
      new_customer_distribution: dist(5),
      churn_distribution: dist(5),
      now: NOW,
    });
    expect(r.state).toBe('unreachable');
    if (r.state === 'unreachable') {
      expect(r.unreachable_reason).toBe('flat');
    }
  });

  it('unreachable too_distant when target requires > 60 months', () => {
    // current 312, net 14 → target 2000 needs ceil((2000-312)/14) = 121 months
    const r = goalEta({
      metric: 'customer_count',
      target_value: 2000,
      current_count: 312,
      new_customer_distribution: dist(18),
      churn_distribution: dist(4),
      now: NOW,
    });
    expect(r.state).toBe('unreachable');
    if (r.state === 'unreachable') {
      expect(r.unreachable_reason).toBe('too_distant');
      expect(r.months_required).toBe(121);
    }
  });

  it('sparse coverage when distributions missing → unreachable flat', () => {
    const r = goalEta({
      metric: 'customer_count',
      target_value: 1000,
      current_count: 312,
      new_customer_distribution: undefined,
      churn_distribution: undefined,
      now: NOW,
    });
    expect(r.coverage).toBe('sparse');
    expect(r.state).toBe('unreachable');
    if (r.state === 'unreachable') {
      expect(r.unreachable_reason).toBe('flat');
    }
  });

  it('definition tag set correctly (customer_count)', () => {
    const r = goalEta({
      metric: 'customer_count',
      target_value: 400,
      current_count: 312,
      new_customer_distribution: dist(18),
      churn_distribution: dist(4),
      now: NOW,
    });
    expect(r.definition).toBe('javelin_defined.goal_eta');
  });

  it('partial coverage flagged when n_months < 6', () => {
    const r = goalEta({
      metric: 'customer_count',
      target_value: 400,
      current_count: 312,
      new_customer_distribution: dist(18, 4),
      churn_distribution: dist(4, 4),
      now: NOW,
    });
    expect(r.coverage).toBe('partial');
  });

  it('exposes monthly_net_additions on customer_count answer', () => {
    const r = goalEta({
      metric: 'customer_count',
      target_value: 500,
      current_count: 312,
      new_customer_distribution: dist(18),
      churn_distribution: dist(4),
      now: NOW,
    });
    expect(r.monthly_net_additions).toBe(14);
  });
});
