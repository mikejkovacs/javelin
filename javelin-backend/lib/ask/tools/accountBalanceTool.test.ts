import { describe, it, expect } from 'vitest';
import { ACCOUNT_BALANCE_INPUT_SCHEMA } from './accountBalanceTool';

describe('ACCOUNT_BALANCE_INPUT_SCHEMA', () => {
  it('accepts empty object (no inputs)', () => {
    expect(() => ACCOUNT_BALANCE_INPUT_SCHEMA.parse({})).not.toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      ACCOUNT_BALANCE_INPUT_SCHEMA.parse({ currency: 'usd' }),
    ).toThrow();
  });
});
