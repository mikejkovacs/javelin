import { describe, it, expect } from 'vitest';
import { GROWTH_RATE_INPUT_SCHEMA } from './growthRateTool';

describe('GROWTH_RATE_INPUT_SCHEMA', () => {
  it('accepts valid metric + window', () => {
    expect(() =>
      GROWTH_RATE_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        window: 6,
      }),
    ).not.toThrow();
  });

  it('defaults window to 6 when omitted', () => {
    const parsed = GROWTH_RATE_INPUT_SCHEMA.parse({
      metric: 'billed_revenue',
    });
    expect(parsed.window).toBe(6);
  });

  it('rejects unknown metric values', () => {
    expect(() =>
      GROWTH_RATE_INPUT_SCHEMA.parse({
        metric: 'mrr', // not in enum
        window: 6,
      }),
    ).toThrow();
  });

  it('rejects window outside 2-12 range', () => {
    expect(() =>
      GROWTH_RATE_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        window: 1,
      }),
    ).toThrow();
    expect(() =>
      GROWTH_RATE_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        window: 13,
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      GROWTH_RATE_INPUT_SCHEMA.parse({
        metric: 'recurring_revenue',
        window: 6,
        currency: 'usd',
      }),
    ).toThrow();
  });

  it('rejects missing metric', () => {
    expect(() =>
      GROWTH_RATE_INPUT_SCHEMA.parse({
        window: 6,
      }),
    ).toThrow();
  });
});
