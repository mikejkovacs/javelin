import { describe, it, expect } from 'vitest';
import { GOAL_ETA_INPUT_SCHEMA } from './goalEtaTool';

describe('GOAL_ETA_INPUT_SCHEMA', () => {
  it('accepts valid revenue-metric inputs', () => {
    expect(() =>
      GOAL_ETA_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        target_value: 100000,
        lookback_months: 6,
      }),
    ).not.toThrow();
  });

  it('accepts customer_count metric', () => {
    expect(() =>
      GOAL_ETA_INPUT_SCHEMA.parse({
        metric: 'customer_count',
        target_value: 1000,
      }),
    ).not.toThrow();
  });

  it('defaults lookback_months to 6 when omitted', () => {
    const parsed = GOAL_ETA_INPUT_SCHEMA.parse({
      metric: 'billed_revenue',
      target_value: 50000,
    });
    expect(parsed.lookback_months).toBe(6);
  });

  it('rejects unknown metric', () => {
    expect(() =>
      GOAL_ETA_INPUT_SCHEMA.parse({
        metric: 'mrr',
        target_value: 100,
      }),
    ).toThrow();
  });

  it('rejects missing target_value', () => {
    expect(() =>
      GOAL_ETA_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
      }),
    ).toThrow();
  });

  it('rejects missing metric', () => {
    expect(() =>
      GOAL_ETA_INPUT_SCHEMA.parse({
        target_value: 100,
      }),
    ).toThrow();
  });

  it('rejects lookback_months outside 2-12', () => {
    expect(() =>
      GOAL_ETA_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        target_value: 100,
        lookback_months: 1,
      }),
    ).toThrow();
    expect(() =>
      GOAL_ETA_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        target_value: 100,
        lookback_months: 13,
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      GOAL_ETA_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        target_value: 100,
        max_horizon_months: 60, // internal constant; not exposed
      }),
    ).toThrow();
  });

  it('accepts negative target_value (sanity check left to LLM/tool logic)', () => {
    expect(() =>
      GOAL_ETA_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        target_value: -100,
      }),
    ).not.toThrow();
  });
});
