import { describe, it, expect } from 'vitest';
import { PAYING_CUSTOMER_COUNT_INPUT_SCHEMA } from './payingCustomerCountTool';

describe('PAYING_CUSTOMER_COUNT_INPUT_SCHEMA', () => {
  it('accepts valid ISO date range', () => {
    expect(() =>
      PAYING_CUSTOMER_COUNT_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
      }),
    ).not.toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() =>
      PAYING_CUSTOMER_COUNT_INPUT_SCHEMA.parse({
        start: '2026-13-45',
        end: '2026-03-31',
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      PAYING_CUSTOMER_COUNT_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        currency: 'usd',
      }),
    ).toThrow();
  });

  it('accepts exclude_fraud boolean', () => {
    expect(() =>
      PAYING_CUSTOMER_COUNT_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        exclude_fraud: true,
      }),
    ).not.toThrow();
  });

  it('exclude_fraud is optional', () => {
    expect(() =>
      PAYING_CUSTOMER_COUNT_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
      }),
    ).not.toThrow();
  });
});
