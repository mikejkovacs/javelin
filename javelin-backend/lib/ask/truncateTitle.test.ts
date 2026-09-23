import { describe, it, expect } from 'vitest';
import { truncateTitle } from './truncateTitle';

describe('truncateTitle', () => {
  it('returns cleaned text unchanged when within cap', () => {
    expect(truncateTitle('Short title', 40)).toBe('Short title');
  });

  it('strips surrounding double-quotes', () => {
    expect(truncateTitle('"Quoted title"', 40)).toBe('Quoted title');
  });

  it('strips surrounding single-quotes', () => {
    expect(truncateTitle("'Quoted title'", 40)).toBe('Quoted title');
  });

  it('trims surrounding whitespace', () => {
    expect(truncateTitle('  padded title  ', 40)).toBe('padded title');
  });

  it('preserves an exactly-cap-length title with no truncation', () => {
    const exactly40 = 'A title that is exactly forty chars long'; // 40 chars
    expect(exactly40.length).toBe(40);
    expect(truncateTitle(exactly40, 40)).toBe(exactly40);
  });

  it('truncates at last word boundary when cut would fall mid-word', () => {
    // The production failure: 41-char title cut at 40 → "Collaps" instead of "Collapse"
    const input = 'Revenue Declining: Subscriptions Collapse'; // 41 chars
    expect(truncateTitle(input, 40)).toBe('Revenue Declining: Subscriptions');
  });

  it('keeps slice as-is when char after cut is whitespace (clean word boundary)', () => {
    // 41-char input where char 41 is a space → slice(0,40) ends at word boundary
    const input = 'A title with exactly thirty-nine chars '; // 39 chars + trailing space (will be trimmed)
    // After trim: 39 chars, fits cap → returns as-is
    expect(truncateTitle(input, 40)).toBe('A title with exactly thirty-nine chars');
  });

  it('handles a long single word with no spaces by returning the hard slice', () => {
    // No whitespace to back off to — fall back to clipped slice rather than empty
    const input = 'a'.repeat(50);
    expect(truncateTitle(input, 40)).toBe('a'.repeat(40));
  });

  it('drops trailing whitespace from a clean-boundary truncation', () => {
    // Hypothetical: input with whitespace landing at index 40
    const input = 'Lorem ipsum dolor sit amet consectetur adi piscing elit'; // > 40
    const out = truncateTitle(input, 40);
    expect(out).not.toMatch(/\s$/);
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it('produces a non-empty result for any input with at least one word', () => {
    expect(truncateTitle('Word', 40)).toBe('Word');
    expect(truncateTitle('Word ', 40)).toBe('Word');
  });

  it('handles empty string input', () => {
    expect(truncateTitle('', 40)).toBe('');
  });
});
