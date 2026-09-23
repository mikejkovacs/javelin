import { bucketize, bucketizeThreads } from './dateBuckets';
import type { ThreadSummary } from '../state/threadReducer';

const NOW = new Date('2026-05-05T15:00:00');

const make = (last_active_at: string, thread_id = 'thr_x'): ThreadSummary => ({
  thread_id,
  title: null,
  created_at: last_active_at,
  last_active_at,
});

describe('bucketize', () => {
  it('exactly start-of-today → today', () => {
    expect(bucketize(make('2026-05-05T00:00:00'), NOW)).toBe('today');
  });

  it('1 second before start-of-today → yesterday', () => {
    expect(bucketize(make('2026-05-04T23:59:59'), NOW)).toBe('yesterday');
  });

  it('start-of-yesterday → yesterday', () => {
    expect(bucketize(make('2026-05-04T00:00:00'), NOW)).toBe('yesterday');
  });

  it('1 second before start-of-yesterday → last_7_days', () => {
    expect(bucketize(make('2026-05-03T23:59:59'), NOW)).toBe('last_7_days');
  });

  it('exactly 6 days ago, midnight → last_7_days', () => {
    expect(bucketize(make('2026-04-29T00:00:00'), NOW)).toBe('last_7_days');
  });

  it('1 second before 6-days-ago boundary → older', () => {
    expect(bucketize(make('2026-04-28T23:59:59'), NOW)).toBe('older');
  });

  it('week+ ago → older', () => {
    expect(bucketize(make('2026-04-20T12:00:00'), NOW)).toBe('older');
  });

  it('current moment → today', () => {
    expect(bucketize(make('2026-05-05T15:00:00'), NOW)).toBe('today');
  });
});

describe('bucketizeThreads', () => {
  it('groups multiple threads correctly', () => {
    const threads: ThreadSummary[] = [
      make('2026-05-05T10:00:00', 'thr_today'),
      make('2026-05-04T18:00:00', 'thr_yesterday'),
      make('2026-05-01T08:00:00', 'thr_week'),
      make('2026-04-15T09:00:00', 'thr_older'),
    ];
    const result = bucketizeThreads(threads, NOW);
    expect(result.today).toHaveLength(1);
    expect(result.today[0].thread_id).toBe('thr_today');
    expect(result.yesterday).toHaveLength(1);
    expect(result.yesterday[0].thread_id).toBe('thr_yesterday');
    expect(result.last_7_days).toHaveLength(1);
    expect(result.last_7_days[0].thread_id).toBe('thr_week');
    expect(result.older).toHaveLength(1);
    expect(result.older[0].thread_id).toBe('thr_older');
  });

  it('preserves input order within each bucket', () => {
    const threads: ThreadSummary[] = [
      make('2026-05-05T10:00:00', 'thr_a'),
      make('2026-05-05T08:00:00', 'thr_b'),
      make('2026-05-05T12:00:00', 'thr_c'),
    ];
    const result = bucketizeThreads(threads, NOW);
    expect(result.today.map((t) => t.thread_id)).toEqual([
      'thr_a',
      'thr_b',
      'thr_c',
    ]);
  });

  it('handles empty input', () => {
    const result = bucketizeThreads([], NOW);
    expect(result.today).toEqual([]);
    expect(result.yesterday).toEqual([]);
    expect(result.last_7_days).toEqual([]);
    expect(result.older).toEqual([]);
  });
});
