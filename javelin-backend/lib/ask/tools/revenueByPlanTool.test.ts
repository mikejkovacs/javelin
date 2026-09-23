import { describe, it, expect } from 'vitest';
import { REVENUE_BY_PLAN_INPUT_SCHEMA } from './revenueByPlanTool';

describe('REVENUE_BY_PLAN_INPUT_SCHEMA', () => {
  it('accepts valid ISO date range', () => {
    expect(() =>
      REVENUE_BY_PLAN_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
      }),
    ).not.toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() =>
      REVENUE_BY_PLAN_INPUT_SCHEMA.parse({
        start: '2026-13-45',
        end: '2026-03-31',
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      REVENUE_BY_PLAN_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        plan: 'Pro Monthly',
      }),
    ).toThrow();
  });

  it('accepts optional granularity values day/week/month', () => {
    for (const g of ['day', 'week', 'month'] as const) {
      expect(() =>
        REVENUE_BY_PLAN_INPUT_SCHEMA.parse({
          start: '2026-03-01',
          end: '2026-03-31',
          granularity: g,
        }),
      ).not.toThrow();
    }
  });

  it('rejects invalid granularity values', () => {
    expect(() =>
      REVENUE_BY_PLAN_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        granularity: 'hour',
      }),
    ).toThrow();
  });

  it('accepts omitted granularity (rows mode)', () => {
    expect(() =>
      REVENUE_BY_PLAN_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
      }),
    ).not.toThrow();
  });
});
