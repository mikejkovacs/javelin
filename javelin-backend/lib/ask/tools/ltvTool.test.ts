import { describe, it, expect } from 'vitest';
import { LTV_INPUT_SCHEMA } from './ltvTool';

describe('LTV_INPUT_SCHEMA', () => {
  it('accepts no arguments (default 30d window)', () => {
    expect(() => LTV_INPUT_SCHEMA.parse({})).not.toThrow();
  });

  it('accepts churn_window: "30d"', () => {
    expect(() => LTV_INPUT_SCHEMA.parse({ churn_window: '30d' })).not.toThrow();
  });

  it('accepts churn_window: "90d"', () => {
    expect(() => LTV_INPUT_SCHEMA.parse({ churn_window: '90d' })).not.toThrow();
  });

  it('accepts churn_window: "365d"', () => {
    expect(() => LTV_INPUT_SCHEMA.parse({ churn_window: '365d' })).not.toThrow();
  });

  it('rejects free-form integer window (enum-restricted)', () => {
    expect(() => LTV_INPUT_SCHEMA.parse({ churn_window: 60 })).toThrow();
    expect(() => LTV_INPUT_SCHEMA.parse({ churn_window: '60d' })).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      LTV_INPUT_SCHEMA.parse({ churn_window: '30d', basis: 'recurring' }),
    ).toThrow();
  });
});
