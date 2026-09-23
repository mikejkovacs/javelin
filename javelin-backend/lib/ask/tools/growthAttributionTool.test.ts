import { describe, it, expect } from 'vitest';
import { GROWTH_ATTRIBUTION_INPUT_SCHEMA } from './growthAttributionTool';

describe('GROWTH_ATTRIBUTION_INPUT_SCHEMA', () => {
  it('accepts valid ISO date range', () => {
    expect(() =>
      GROWTH_ATTRIBUTION_INPUT_SCHEMA.parse({
        start: '2026-01-01',
        end: '2026-03-31',
      }),
    ).not.toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() =>
      GROWTH_ATTRIBUTION_INPUT_SCHEMA.parse({
        start: '2026-13-45',
        end: '2026-03-31',
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      GROWTH_ATTRIBUTION_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        dimension: 'plan',  // V1 has no dimension param; the field is reserved
                            // for future expansion but the schema is strict.
      }),
    ).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() =>
      GROWTH_ATTRIBUTION_INPUT_SCHEMA.parse({
        start: '2026-03-01',
      }),
    ).toThrow();
  });

  it('accepts long time windows (indefinite F1 advantage inherited from mrr_movement)', () => {
    expect(() =>
      GROWTH_ATTRIBUTION_INPUT_SCHEMA.parse({
        start: '2025-01-01',
        end: '2026-04-30',
      }),
    ).not.toThrow();
  });
});
