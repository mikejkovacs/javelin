import { describe, it, expect } from 'vitest';
import { CHURN_RATE_INPUT_SCHEMA } from './churnRateTool';

describe('CHURN_RATE_INPUT_SCHEMA', () => {
  it('accepts empty input (no period args — fixed 30-day window)', () => {
    expect(() => CHURN_RATE_INPUT_SCHEMA.parse({})).not.toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      CHURN_RATE_INPUT_SCHEMA.parse({ start: '2026-03-01' }),
    ).toThrow();
  });
});
