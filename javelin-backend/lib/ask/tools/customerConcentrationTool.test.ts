import { describe, it, expect } from 'vitest';
import { CUSTOMER_CONCENTRATION_INPUT_SCHEMA as SCHEMA } from './customerConcentrationTool';

describe('CUSTOMER_CONCENTRATION_INPUT_SCHEMA', () => {
  it('accepts a valid date range with explicit top_n', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31', top_n: 3 }),
    ).not.toThrow();
  });

  it('defaults top_n to 5 when omitted', () => {
    const parsed = SCHEMA.parse({
      start: '2026-01-01',
      end: '2026-03-31',
    });
    expect(parsed.top_n).toBe(5);
  });

  it('rejects missing date fields', () => {
    expect(() => SCHEMA.parse({ top_n: 3 })).toThrow();
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

  it('rejects negative top_n', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31', top_n: -1 }),
    ).toThrow();
  });

  it('rejects zero top_n', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31', top_n: 0 }),
    ).toThrow();
  });

  it('rejects non-integer top_n', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31', top_n: 5.5 }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      SCHEMA.parse({
        start: '2026-01-01',
        end: '2026-03-31',
        top_n: 5,
        currency: 'usd',
      }),
    ).toThrow();
  });
});
