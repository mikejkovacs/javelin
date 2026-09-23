import { describe, it, expect } from 'vitest';
import { CHURN_COUNT_INPUT_SCHEMA } from './churnCountTool';

describe('CHURN_COUNT_INPUT_SCHEMA', () => {
  it('accepts valid ISO date range', () => {
    expect(() =>
      CHURN_COUNT_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
      }),
    ).not.toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() =>
      CHURN_COUNT_INPUT_SCHEMA.parse({
        start: '2026-13-45',
        end: '2026-03-31',
      }),
    ).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() =>
      CHURN_COUNT_INPUT_SCHEMA.parse({ start: '2026-03-01' }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      CHURN_COUNT_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        top_n: 5,
      }),
    ).toThrow();
  });
});
