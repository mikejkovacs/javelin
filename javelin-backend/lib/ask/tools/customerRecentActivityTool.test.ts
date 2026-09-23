import { describe, it, expect } from 'vitest';
import { CUSTOMER_RECENT_ACTIVITY_INPUT_SCHEMA } from './customerRecentActivityTool';

describe('CUSTOMER_RECENT_ACTIVITY_INPUT_SCHEMA', () => {
  it('accepts customer_id only (defaults trailing 90d)', () => {
    expect(() =>
      CUSTOMER_RECENT_ACTIVITY_INPUT_SCHEMA.parse({ customer_id: 'cus_x' }),
    ).not.toThrow();
  });

  it('accepts customer_id + start + end', () => {
    expect(() =>
      CUSTOMER_RECENT_ACTIVITY_INPUT_SCHEMA.parse({
        customer_id: 'cus_x',
        start: '2026-03-01',
        end: '2026-03-31',
      }),
    ).not.toThrow();
  });

  it('rejects customer_id missing the cus_ prefix', () => {
    expect(() =>
      CUSTOMER_RECENT_ACTIVITY_INPUT_SCHEMA.parse({ customer_id: 'jenny' }),
    ).toThrow();
  });

  it('rejects start without end (or vice versa)', () => {
    expect(() =>
      CUSTOMER_RECENT_ACTIVITY_INPUT_SCHEMA.parse({
        customer_id: 'cus_x',
        start: '2026-03-01',
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      CUSTOMER_RECENT_ACTIVITY_INPUT_SCHEMA.parse({
        customer_id: 'cus_x',
        types: ['charge'],
      }),
    ).toThrow();
  });
});
