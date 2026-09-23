import { describe, it, expect } from 'vitest';
import { CUSTOMER_SPEND_DISTRIBUTION_INPUT_SCHEMA as SCHEMA } from './customerSpendDistributionTool';

describe('CUSTOMER_SPEND_DISTRIBUTION_INPUT_SCHEMA', () => {
  it('accepts a valid date range', () => {
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

  it('rejects malformed dates', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-1-1', end: '2026-03-31' }),
    ).toThrow();
  });

  it('rejects calendar-invalid dates', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-13-45', end: '2026-12-31' }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      SCHEMA.parse({
        start: '2026-01-01',
        end: '2026-03-31',
        n: 5,
      }),
    ).toThrow();
  });
});
