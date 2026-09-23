import { describe, it, expect } from 'vitest';
import { comparePeriods } from './comparePeriods';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const MARCH = {
  start: Math.floor(Date.UTC(2026, 2, 1) / 1000),
  end: Math.floor(Date.UTC(2026, 2, 31, 23, 59, 59) / 1000),
};
const APRIL = {
  start: Math.floor(Date.UTC(2026, 3, 1) / 1000),
  end: Math.floor(Date.UTC(2026, 3, 30, 23, 59, 59) / 1000),
};

describe('compare_periods', () => {
  it('revenue down: delta_absolute, delta_percent, direction', () => {
    const r = comparePeriods({
      metric: 'period_collected_revenue',
      a: { value: 3700, period: MARCH },
      b: { value: 850, period: APRIL },
      unit: 'usd',
      currency: 'usd',
      now: NOW,
    });
    expect(r.delta_absolute).toBe(-2850);
    expect(r.delta_percent).toBeCloseTo(-0.7702702702, 6);
    expect(r.direction).toBe('down');
  });

  it('count up: integer delta, direction', () => {
    const r = comparePeriods({
      metric: 'churn_count',
      a: { value: 5, period: MARCH },
      b: { value: 6, period: APRIL },
      unit: 'count',
      now: NOW,
    });
    expect(r.delta_absolute).toBe(1);
    expect(r.delta_percent).toBeCloseTo(0.2);
    expect(r.direction).toBe('up');
  });

  it('flat: equal values', () => {
    const r = comparePeriods({
      metric: 'churn_count',
      a: { value: 5, period: MARCH },
      b: { value: 5, period: APRIL },
      unit: 'count',
      now: NOW,
    });
    expect(r.delta_absolute).toBe(0);
    expect(r.direction).toBe('flat');
    expect(r.delta_percent).toBe(0);
  });

  it('flat: sub-penny diff for usd', () => {
    const r = comparePeriods({
      metric: 'period_collected_revenue',
      a: { value: 100.0, period: MARCH },
      b: { value: 100.005, period: APRIL },
      unit: 'usd',
      currency: 'usd',
      now: NOW,
    });
    expect(r.direction).toBe('flat');
  });

  it('zero baseline → delta_percent null', () => {
    const r = comparePeriods({
      metric: 'churn_count',
      a: { value: 0, period: MARCH },
      b: { value: 3, period: APRIL },
      unit: 'count',
      now: NOW,
    });
    expect(r.delta_absolute).toBe(3);
    expect(r.delta_percent).toBeNull();
    expect(r.direction).toBe('up');
  });

  it('same period A and B → delta 0, direction flat (allowed edge)', () => {
    const r = comparePeriods({
      metric: 'period_collected_revenue',
      a: { value: 3700, period: MARCH },
      b: { value: 3700, period: MARCH },
      unit: 'usd',
      currency: 'usd',
      now: NOW,
    });
    expect(r.delta_absolute).toBe(0);
    expect(r.direction).toBe('flat');
  });

  it('output envelope: scalar, definition, currency for usd, as_of', () => {
    const r = comparePeriods({
      metric: 'period_billed_revenue',
      a: { value: 1000, period: MARCH },
      b: { value: 1500, period: APRIL },
      unit: 'usd',
      currency: 'usd',
      now: NOW,
    });
    expect(r.kind).toBe('scalar');
    expect(r.definition).toBe('javelin_defined.compare_periods');
    expect(r.currency).toBe('usd');
    expect(r.as_of).toBe(NOW_SEC);
    expect(r.metric).toBe('period_billed_revenue');
  });

  it('count metric: no currency in output', () => {
    const r = comparePeriods({
      metric: 'churn_count',
      a: { value: 5, period: MARCH },
      b: { value: 6, period: APRIL },
      unit: 'count',
      now: NOW,
    });
    expect(r.currency).toBeUndefined();
  });
});
