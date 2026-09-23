import { describe, it, expect } from 'vitest';
import { BALANCE_EXPLANATION_INPUT_SCHEMA } from './balanceExplanationTool';

describe('BALANCE_EXPLANATION_INPUT_SCHEMA', () => {
  it('accepts valid ISO date range', () => {
    expect(() =>
      BALANCE_EXPLANATION_INPUT_SCHEMA.parse({
        start: '2026-03-30',
        end: '2026-04-29',
      }),
    ).not.toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() =>
      BALANCE_EXPLANATION_INPUT_SCHEMA.parse({
        start: '2026-13-45',
        end: '2026-04-29',
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      BALANCE_EXPLANATION_INPUT_SCHEMA.parse({
        start: '2026-03-30',
        end: '2026-04-29',
        currency: 'usd',
      }),
    ).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() =>
      BALANCE_EXPLANATION_INPUT_SCHEMA.parse({ start: '2026-03-30' }),
    ).toThrow();
  });
});
