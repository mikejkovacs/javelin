import { describe, it, expect } from 'vitest';
import { PROJECT_CUSTOMER_COUNT_INPUT_SCHEMA } from './projectCustomerCountTool';

describe('PROJECT_CUSTOMER_COUNT_INPUT_SCHEMA', () => {
  it('accepts valid horizon_months', () => {
    expect(() =>
      PROJECT_CUSTOMER_COUNT_INPUT_SCHEMA.parse({ horizon_months: 6 }),
    ).not.toThrow();
  });

  it('defaults horizon_months to 3 when omitted', () => {
    const parsed = PROJECT_CUSTOMER_COUNT_INPUT_SCHEMA.parse({});
    expect(parsed.horizon_months).toBe(3);
  });

  it('rejects horizon_months outside 1-12', () => {
    expect(() =>
      PROJECT_CUSTOMER_COUNT_INPUT_SCHEMA.parse({ horizon_months: 0 }),
    ).toThrow();
    expect(() =>
      PROJECT_CUSTOMER_COUNT_INPUT_SCHEMA.parse({ horizon_months: 13 }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      PROJECT_CUSTOMER_COUNT_INPUT_SCHEMA.parse({
        horizon_months: 3,
        metric: 'customer_count',
      }),
    ).toThrow();
  });
});
