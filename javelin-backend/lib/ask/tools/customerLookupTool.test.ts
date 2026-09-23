import { describe, it, expect } from 'vitest';
import { CUSTOMER_LOOKUP_INPUT_SCHEMA } from './customerLookupTool';

describe('CUSTOMER_LOOKUP_INPUT_SCHEMA', () => {
  it('accepts name only', () => {
    expect(() =>
      CUSTOMER_LOOKUP_INPUT_SCHEMA.parse({ name: 'Jenny Rosen' }),
    ).not.toThrow();
  });

  it('accepts email only', () => {
    expect(() =>
      CUSTOMER_LOOKUP_INPUT_SCHEMA.parse({ email: 'a@b.com' }),
    ).not.toThrow();
  });

  it('accepts id only', () => {
    expect(() =>
      CUSTOMER_LOOKUP_INPUT_SCHEMA.parse({ id: 'cus_x' }),
    ).not.toThrow();
  });

  it('rejects empty input (none of name/email/id provided)', () => {
    expect(() => CUSTOMER_LOOKUP_INPUT_SCHEMA.parse({})).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      CUSTOMER_LOOKUP_INPUT_SCHEMA.parse({ name: 'X', country: 'US' }),
    ).toThrow();
  });
});
