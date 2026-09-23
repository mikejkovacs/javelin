import { describe, it, expect } from 'vitest';
import { ARPU_INPUT_SCHEMA } from './arpuTool';

describe('ARPU_INPUT_SCHEMA', () => {
  it('accepts basis=recurring without dates', () => {
    expect(() => ARPU_INPUT_SCHEMA.parse({ basis: 'recurring' })).not.toThrow();
  });

  it('accepts basis=collected with valid date range', () => {
    expect(() =>
      ARPU_INPUT_SCHEMA.parse({
        basis: 'collected',
        start: '2026-01-01',
        end: '2026-03-31',
      }),
    ).not.toThrow();
  });

  it('rejects basis=collected without dates', () => {
    expect(() => ARPU_INPUT_SCHEMA.parse({ basis: 'collected' })).toThrow();
  });

  it('rejects basis=collected with only start', () => {
    expect(() =>
      ARPU_INPUT_SCHEMA.parse({ basis: 'collected', start: '2026-01-01' }),
    ).toThrow();
  });

  it('rejects unknown basis', () => {
    expect(() => ARPU_INPUT_SCHEMA.parse({ basis: 'projected' })).toThrow();
  });

  it('rejects malformed date format', () => {
    expect(() =>
      ARPU_INPUT_SCHEMA.parse({
        basis: 'collected',
        start: '01/01/2026',
        end: '03/31/2026',
      }),
    ).toThrow();
  });

  it('rejects calendar-invalid dates', () => {
    expect(() =>
      ARPU_INPUT_SCHEMA.parse({
        basis: 'collected',
        start: '2026-13-45',
        end: '2026-12-31',
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      ARPU_INPUT_SCHEMA.parse({ basis: 'recurring', currency: 'usd' }),
    ).toThrow();
  });

  it('rejects missing basis', () => {
    expect(() => ARPU_INPUT_SCHEMA.parse({})).toThrow();
  });
});
