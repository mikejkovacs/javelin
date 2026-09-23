import { describe, it, expect } from 'vitest';
import { MRR_INPUT_SCHEMA } from './mrrTool';

describe('MRR_INPUT_SCHEMA', () => {
  it('accepts empty input (mrr takes no args)', () => {
    expect(() => MRR_INPUT_SCHEMA.parse({})).not.toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() => MRR_INPUT_SCHEMA.parse({ start: '2026-01-01' })).toThrow();
  });
});
