import { describe, it, expect } from 'vitest';
import { PROJECT_REVENUE_INPUT_SCHEMA } from './projectRevenueTool';

describe('PROJECT_REVENUE_INPUT_SCHEMA', () => {
  it('accepts valid metric + lookback + horizon', () => {
    expect(() =>
      PROJECT_REVENUE_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        lookback_months: 6,
        horizon_months: 3,
      }),
    ).not.toThrow();
  });

  it('defaults lookback_months to 6 and horizon_months to 3 when omitted', () => {
    const parsed = PROJECT_REVENUE_INPUT_SCHEMA.parse({
      metric: 'billed_revenue',
    });
    expect(parsed.lookback_months).toBe(6);
    expect(parsed.horizon_months).toBe(3);
  });

  it('rejects unknown metric values', () => {
    expect(() =>
      PROJECT_REVENUE_INPUT_SCHEMA.parse({
        metric: 'mrr',
        horizon_months: 3,
      }),
    ).toThrow();
  });

  it('rejects lookback_months outside 2-12', () => {
    expect(() =>
      PROJECT_REVENUE_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        lookback_months: 1,
      }),
    ).toThrow();
    expect(() =>
      PROJECT_REVENUE_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        lookback_months: 13,
      }),
    ).toThrow();
  });

  it('rejects horizon_months outside 1-12', () => {
    expect(() =>
      PROJECT_REVENUE_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        horizon_months: 0,
      }),
    ).toThrow();
    expect(() =>
      PROJECT_REVENUE_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        horizon_months: 13,
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      PROJECT_REVENUE_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        horizon_months: 3,
        currency: 'usd',
      }),
    ).toThrow();
  });

  it('rejects missing metric', () => {
    expect(() =>
      PROJECT_REVENUE_INPUT_SCHEMA.parse({
        horizon_months: 3,
      }),
    ).toThrow();
  });
});
