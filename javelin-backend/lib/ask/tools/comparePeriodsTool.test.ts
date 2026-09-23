import { describe, it, expect } from 'vitest';
import { COMPARE_PERIODS_INPUT_SCHEMA } from './comparePeriodsTool';

describe('COMPARE_PERIODS_INPUT_SCHEMA', () => {
  it('accepts a valid input with supported metric and two periods', () => {
    expect(() =>
      COMPARE_PERIODS_INPUT_SCHEMA.parse({
        metric: 'period_collected_revenue',
        period_a: { start: '2026-03-01', end: '2026-03-31' },
        period_b: { start: '2026-04-01', end: '2026-04-30' },
      }),
    ).not.toThrow();
  });

  it('accepts churn_count metric', () => {
    expect(() =>
      COMPARE_PERIODS_INPUT_SCHEMA.parse({
        metric: 'churn_count',
        period_a: { start: '2025-10-01', end: '2025-12-31' },
        period_b: { start: '2026-01-01', end: '2026-03-31' },
      }),
    ).not.toThrow();
  });

  it('rejects unsupported metric', () => {
    expect(() =>
      COMPARE_PERIODS_INPUT_SCHEMA.parse({
        metric: 'mrr', // snapshot, not period-bound — excluded
        period_a: { start: '2026-03-01', end: '2026-03-31' },
        period_b: { start: '2026-04-01', end: '2026-04-30' },
      }),
    ).toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() =>
      COMPARE_PERIODS_INPUT_SCHEMA.parse({
        metric: 'churn_count',
        period_a: { start: '2026-13-45', end: '2026-03-31' },
        period_b: { start: '2026-04-01', end: '2026-04-30' },
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      COMPARE_PERIODS_INPUT_SCHEMA.parse({
        metric: 'churn_count',
        period_a: { start: '2026-03-01', end: '2026-03-31' },
        period_b: { start: '2026-04-01', end: '2026-04-30' },
        extra: 'value',
      }),
    ).toThrow();
  });
});
