import { describe, it, expect } from 'vitest';
import { PERIOD_COLLECTED_REVENUE_INPUT_SCHEMA as SCHEMA } from './periodCollectedRevenueTool';

describe('PERIOD_COLLECTED_REVENUE_INPUT_SCHEMA', () => {
  it('accepts a valid ISO date range', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31' }),
    ).not.toThrow();
  });

  it('rejects missing start', () => {
    expect(() => SCHEMA.parse({ end: '2026-03-31' })).toThrow();
  });

  it('rejects missing end', () => {
    expect(() => SCHEMA.parse({ start: '2026-01-01' })).toThrow();
  });

  it('rejects malformed date format', () => {
    expect(() => SCHEMA.parse({ start: '2026-1-1', end: '2026-3-31' })).toThrow();
    expect(() => SCHEMA.parse({ start: 'January 1', end: '2026-03-31' })).toThrow();
    expect(() => SCHEMA.parse({ start: '01/01/2026', end: '03/31/2026' })).toThrow();
  });

  it('rejects calendar-invalid dates that pass the regex (e.g. month 13)', () => {
    // Regex passes "2026-13-45" but it's not a real date; .refine catches it.
    expect(() => SCHEMA.parse({ start: '2026-13-45', end: '2026-12-31' })).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      SCHEMA.parse({
        start: '2026-01-01',
        end: '2026-03-31',
        currency: 'usd',
      }),
    ).toThrow();
  });

  it('accepts exclude_fraud boolean', () => {
    expect(() =>
      SCHEMA.parse({
        start: '2026-01-01',
        end: '2026-03-31',
        exclude_fraud: true,
      }),
    ).not.toThrow();
  });
});
