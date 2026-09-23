import { describe, it, expect } from 'vitest';
import { ACTIVE_SUBSCRIPTION_COUNT_INPUT_SCHEMA } from './activeSubscriptionCountTool';

describe('ACTIVE_SUBSCRIPTION_COUNT_INPUT_SCHEMA', () => {
  it('accepts empty input (active_subscription_count takes no args)', () => {
    expect(() =>
      ACTIVE_SUBSCRIPTION_COUNT_INPUT_SCHEMA.parse({}),
    ).not.toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      ACTIVE_SUBSCRIPTION_COUNT_INPUT_SCHEMA.parse({ start: '2026-01-01' }),
    ).toThrow();
  });
});
