import { describe, it, expect } from 'vitest';
import { projectCustomerCount } from './projectCustomerCount';
import type { Distribution } from '../profile/types';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0)); // 2026-04-29

function dist(median: number, nMonths = 6): Distribution {
  return { min: Math.max(1, median - 5), median, max: median + 10, n_months: nMonths };
}

describe('project_customer_count', () => {
  it('linearly projects current_count + net × horizon (growing trajectory)', () => {
    const r = projectCustomerCount({
      current_count: 312,
      new_customer_distribution: dist(18),
      churn_distribution: dist(4),
      horizon_months: 6,
      now: NOW,
    });
    // net = 14; 312 + 14*6 = 396
    expect(r.monthly_net_additions).toBe(14);
    expect(r.projected_value).toBe(396);
    expect(r.trend_label).toBe('growing');
  });

  it('declining trend when net is negative', () => {
    const r = projectCustomerCount({
      current_count: 100,
      new_customer_distribution: dist(2),
      churn_distribution: dist(8),
      horizon_months: 3,
      now: NOW,
    });
    expect(r.monthly_net_additions).toBe(-6);
    expect(r.trend_label).toBe('declining');
    // 100 + (-6 * 3) = 82
    expect(r.projected_value).toBe(82);
  });

  it('flat trend when net is small relative to current_count (<1% threshold)', () => {
    // 1000 customers, net = 5 → 0.5% per month → flat
    const r = projectCustomerCount({
      current_count: 1000,
      new_customer_distribution: dist(7),
      churn_distribution: dist(2),
      horizon_months: 6,
      now: NOW,
    });
    expect(r.monthly_net_additions).toBe(5);
    expect(r.trend_label).toBe('flat');
  });

  it('floors projected_value at 0 on declining trajectory', () => {
    // current 50, net -10, horizon 6 → would be -10; clamped to 0
    const r = projectCustomerCount({
      current_count: 50,
      new_customer_distribution: dist(2),
      churn_distribution: dist(12),
      horizon_months: 6,
      now: NOW,
    });
    expect(r.projected_value).toBe(0);
    expect(r.trend_label).toBe('declining');
  });

  it('projected_month is current month + horizon', () => {
    const r = projectCustomerCount({
      current_count: 100,
      new_customer_distribution: dist(10),
      churn_distribution: dist(3),
      horizon_months: 6,
      now: NOW, // 2026-04
    });
    expect(r.projected_month).toBe('2026-10');
  });

  it('horizon spanning year boundary rolls month correctly', () => {
    const r = projectCustomerCount({
      current_count: 100,
      new_customer_distribution: dist(10),
      churn_distribution: dist(3),
      horizon_months: 12,
      now: NOW,
    });
    expect(r.projected_month).toBe('2027-04');
  });

  it('missing current_count → coverage sparse, current 0', () => {
    const r = projectCustomerCount({
      current_count: undefined,
      new_customer_distribution: dist(10),
      churn_distribution: dist(3),
      horizon_months: 3,
      now: NOW,
    });
    expect(r.coverage).toBe('sparse');
    expect(r.current_value).toBe(0);
    expect(r.projected_value).toBe(0);
    expect(r.trend_label).toBe('flat');
  });

  it('missing new_customer_distribution → coverage sparse', () => {
    const r = projectCustomerCount({
      current_count: 312,
      new_customer_distribution: undefined,
      churn_distribution: dist(4),
      horizon_months: 3,
      now: NOW,
    });
    expect(r.coverage).toBe('sparse');
  });

  it('missing churn_distribution → coverage sparse', () => {
    const r = projectCustomerCount({
      current_count: 312,
      new_customer_distribution: dist(18),
      churn_distribution: undefined,
      horizon_months: 3,
      now: NOW,
    });
    expect(r.coverage).toBe('sparse');
  });

  it('partial coverage when distributions n_months < 6 (but >= 3)', () => {
    const r = projectCustomerCount({
      current_count: 100,
      new_customer_distribution: dist(10, 4),
      churn_distribution: dist(3, 5),
      horizon_months: 3,
      now: NOW,
    });
    expect(r.coverage).toBe('partial');
  });

  it('sparse coverage when distributions n_months < 3', () => {
    const r = projectCustomerCount({
      current_count: 100,
      new_customer_distribution: dist(10, 2),
      churn_distribution: dist(3, 6),
      horizon_months: 3,
      now: NOW,
    });
    expect(r.coverage).toBe('sparse');
  });

  it('current_count = 0 with positive net → growing', () => {
    const r = projectCustomerCount({
      current_count: 0,
      new_customer_distribution: dist(10),
      churn_distribution: dist(2),
      horizon_months: 3,
      now: NOW,
    });
    expect(r.trend_label).toBe('growing');
    expect(r.projected_value).toBe(24);
  });

  it('definition tag set correctly', () => {
    const r = projectCustomerCount({
      current_count: 100,
      new_customer_distribution: dist(10),
      churn_distribution: dist(3),
      horizon_months: 1,
      now: NOW,
    });
    expect(r.definition).toBe('javelin_defined.project_customer_count');
  });

  it('window echoed in result', () => {
    const r = projectCustomerCount({
      current_count: 100,
      new_customer_distribution: dist(10),
      churn_distribution: dist(3),
      horizon_months: 9,
      now: NOW,
    });
    expect(r.window.horizon_months).toBe(9);
  });

  it('default horizon=3 against fixture-shaped inputs (Modern-Cents-like)', () => {
    const r = projectCustomerCount({
      current_count: 312,
      new_customer_distribution: dist(18),
      churn_distribution: dist(4),
      horizon_months: 3,
      now: NOW,
    });
    // 312 + 14*3 = 354
    expect(r.projected_value).toBe(354);
    expect(r.trend_label).toBe('growing');
  });
});
