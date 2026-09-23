import { describe, it, expect } from 'vitest';
import { bucketKey, bucketKeysForPeriod, bucketCount, MAX_BUCKETS } from './bucketing';

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe('bucketing', () => {
  describe('bucketKey', () => {
    it('day — formats YYYY-MM-DD UTC', () => {
      expect(bucketKey(sec('2026-03-05T00:00:00Z'), 'day')).toBe('2026-03-05');
      expect(bucketKey(sec('2026-03-05T23:59:59Z'), 'day')).toBe('2026-03-05');
    });

    it('week — Monday-start, ISO-8601', () => {
      // 2026-03-05 is a Thursday → Monday is 2026-03-02
      expect(bucketKey(sec('2026-03-05T00:00:00Z'), 'week')).toBe('2026-03-02');
      // 2026-03-02 is the Monday → maps to itself
      expect(bucketKey(sec('2026-03-02T00:00:00Z'), 'week')).toBe('2026-03-02');
      // 2026-03-08 is a Sunday → still part of the week starting 2026-03-02
      expect(bucketKey(sec('2026-03-08T23:59:59Z'), 'week')).toBe('2026-03-02');
      // 2026-03-09 is a Monday → starts a new week
      expect(bucketKey(sec('2026-03-09T00:00:00Z'), 'week')).toBe('2026-03-09');
    });

    it('week — handles Sunday correctly (JS getDay returns 0)', () => {
      // 2026-03-01 is a Sunday → week-start is the previous Monday 2026-02-23
      expect(bucketKey(sec('2026-03-01T00:00:00Z'), 'week')).toBe('2026-02-23');
    });

    it('month — formats YYYY-MM UTC', () => {
      expect(bucketKey(sec('2026-03-05T00:00:00Z'), 'month')).toBe('2026-03');
      expect(bucketKey(sec('2026-03-31T23:59:59Z'), 'month')).toBe('2026-03');
      expect(bucketKey(sec('2026-04-01T00:00:00Z'), 'month')).toBe('2026-04');
    });
  });

  describe('bucketKeysForPeriod', () => {
    it('day — emits every day inclusive', () => {
      const keys = bucketKeysForPeriod(
        { start: sec('2026-03-01T00:00:00Z'), end: sec('2026-03-05T23:59:59Z') },
        'day',
      );
      expect(keys).toEqual([
        '2026-03-01',
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
      ]);
    });

    it('day — full March 2026 = 31 buckets', () => {
      const keys = bucketKeysForPeriod(
        { start: sec('2026-03-01T00:00:00Z'), end: sec('2026-03-31T23:59:59Z') },
        'day',
      );
      expect(keys).toHaveLength(31);
      expect(keys[0]).toBe('2026-03-01');
      expect(keys[30]).toBe('2026-03-31');
    });

    it('week — emits Monday-start week keys, inclusive', () => {
      // Period covers 2026-03-01 (Sun) → 2026-03-21 (Sat)
      // Weeks: 2026-02-23, 2026-03-02, 2026-03-09, 2026-03-16
      const keys = bucketKeysForPeriod(
        { start: sec('2026-03-01T00:00:00Z'), end: sec('2026-03-21T23:59:59Z') },
        'week',
      );
      expect(keys).toEqual(['2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16']);
    });

    it('month — emits month keys inclusive across year boundary', () => {
      const keys = bucketKeysForPeriod(
        { start: sec('2025-11-15T00:00:00Z'), end: sec('2026-02-10T00:00:00Z') },
        'month',
      );
      expect(keys).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });

    it('single-bucket period — day', () => {
      const keys = bucketKeysForPeriod(
        { start: sec('2026-03-05T00:00:00Z'), end: sec('2026-03-05T23:59:59Z') },
        'day',
      );
      expect(keys).toEqual(['2026-03-05']);
    });

    it('single-bucket period — month', () => {
      const keys = bucketKeysForPeriod(
        { start: sec('2026-03-05T00:00:00Z'), end: sec('2026-03-22T00:00:00Z') },
        'month',
      );
      expect(keys).toEqual(['2026-03']);
    });
  });

  describe('bucketCount', () => {
    it('matches bucketKeysForPeriod length', () => {
      const period = {
        start: sec('2026-01-01T00:00:00Z'),
        end: sec('2026-03-31T23:59:59Z'),
      };
      expect(bucketCount(period, 'day')).toBe(
        bucketKeysForPeriod(period, 'day').length,
      );
      expect(bucketCount(period, 'week')).toBe(
        bucketKeysForPeriod(period, 'week').length,
      );
      expect(bucketCount(period, 'month')).toBe(
        bucketKeysForPeriod(period, 'month').length,
      );
    });

    it('Q1 2026 daily = 90 days (the cap)', () => {
      // Jan(31) + Feb(28) + Mar(31) = 90
      const period = {
        start: sec('2026-01-01T00:00:00Z'),
        end: sec('2026-03-31T23:59:59Z'),
      };
      expect(bucketCount(period, 'day')).toBe(90);
    });
  });

  describe('MAX_BUCKETS', () => {
    it('caps locked at 90/52/36', () => {
      expect(MAX_BUCKETS).toEqual({ day: 90, week: 52, month: 36 });
    });
  });
});
