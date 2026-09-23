import { describe, it, expect } from 'vitest';
import { FAILED_PAYMENTS_INPUT_SCHEMA } from './failedPaymentsTool';

describe('FAILED_PAYMENTS_INPUT_SCHEMA', () => {
  it('accepts valid date range', () => {
    expect(() =>
      FAILED_PAYMENTS_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
      }),
    ).not.toThrow();
  });

  it('accepts optional top_n', () => {
    expect(() =>
      FAILED_PAYMENTS_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        top_n: 10,
      }),
    ).not.toThrow();
  });

  it('rejects top_n > 20', () => {
    expect(() =>
      FAILED_PAYMENTS_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        top_n: 50,
      }),
    ).toThrow();
  });

  it('rejects top_n < 1', () => {
    expect(() =>
      FAILED_PAYMENTS_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        top_n: 0,
      }),
    ).toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() =>
      FAILED_PAYMENTS_INPUT_SCHEMA.parse({
        start: '2026-13-45',
        end: '2026-03-31',
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict)', () => {
    expect(() =>
      FAILED_PAYMENTS_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        currency: 'usd',
      }),
    ).toThrow();
  });
});
