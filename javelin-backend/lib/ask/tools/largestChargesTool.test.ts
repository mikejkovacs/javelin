import { describe, it, expect } from 'vitest';
import { LARGEST_CHARGES_INPUT_SCHEMA as SCHEMA } from './largestChargesTool';

describe('LARGEST_CHARGES_INPUT_SCHEMA', () => {
  it('accepts a valid date range with explicit n', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31', n: 3 }),
    ).not.toThrow();
  });

  it('defaults n to 5 when omitted', () => {
    const parsed = SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31' });
    expect(parsed.n).toBe(5);
  });

  it('caps n at 10', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31', n: 11 }),
    ).toThrow();
  });

  it('accepts n = 10 (boundary)', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31', n: 10 }),
    ).not.toThrow();
  });

  it('rejects missing date fields', () => {
    expect(() => SCHEMA.parse({ n: 3 })).toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-1-1', end: '2026-03-31' }),
    ).toThrow();
  });

  it('rejects negative n', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31', n: -1 }),
    ).toThrow();
  });

  it('rejects zero n', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31', n: 0 }),
    ).toThrow();
  });

  it('rejects non-integer n', () => {
    expect(() =>
      SCHEMA.parse({ start: '2026-01-01', end: '2026-03-31', n: 5.5 }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      SCHEMA.parse({
        start: '2026-01-01',
        end: '2026-03-31',
        n: 5,
        currency: 'usd',
      }),
    ).toThrow();
  });
});
