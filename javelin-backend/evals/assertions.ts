// Assertion helpers for eval cases.
//
// Two surfaces:
//   - expectToolCalls — strict on tool name + count + order; per-call args are
//     either strict-match or range-tolerant for ambiguous date phrasings.
//   - expectAnswerConstraints — declarative checklist over the LLM's final text
//     (must-include substrings, must-not-include substrings, max sentence count).
//
// Throws Vitest expect() errors with descriptive messages so failing evals
// surface what went wrong without re-running.

import { expect } from 'vitest';
import type { EvalToolCall } from './runner';

// ──────────────────────────────────────────────────────────────────────────────
// Tool-call expectations
// ──────────────────────────────────────────────────────────────────────────────

export interface ExpectedToolCall {
  name: string;
  /** Exact match — every named field must equal exactly. Extra fields in the
   *  actual call (beyond what's specified here) are NOT allowed when using
   *  argsExact. Use this for unambiguous date phrases ("Q4 2025") and
   *  argument-less tools (mrr, active_subscription_count). */
  argsExact?: Record<string, unknown>;
  /** Tolerant match for date ranges where the LLM has reasonable interpretive
   *  latitude ("last week" — Sunday-start vs. Monday-start, etc.). Specify the
   *  expected start/end ISO date and the maximum allowed deviation in days. */
  argsDateRangeTolerant?: {
    start: string;     // ISO YYYY-MM-DD
    end: string;       // ISO YYYY-MM-DD
    toleranceDays: number;
    /** Other args (e.g. top_n) that must match exactly even in tolerant mode. */
    otherArgsExact?: Record<string, unknown>;
  };
}

export function expectToolCalls(
  actual: EvalToolCall[],
  expected: ExpectedToolCall[],
): void {
  // Strict on count.
  expect(
    actual.length,
    `expected ${expected.length} tool call(s), got ${actual.length}: ${actual
      .map((c) => c.name)
      .join(', ')}`,
  ).toBe(expected.length);

  for (let i = 0; i < expected.length; i++) {
    const a = actual[i];
    const e = expected[i];

    // Strict on tool name + order.
    expect(a.name, `tool call #${i + 1}: expected "${e.name}", got "${a.name}"`).toBe(e.name);

    if (e.argsExact !== undefined) {
      expect(
        a.input,
        `tool call #${i + 1} (${e.name}): args mismatch`,
      ).toEqual(e.argsExact);
    } else if (e.argsDateRangeTolerant !== undefined) {
      assertDateRangeWithinTolerance(a, e);
    }
    // If neither argsExact nor argsDateRangeTolerant: any args accepted.
  }
}

function assertDateRangeWithinTolerance(
  actual: EvalToolCall,
  expected: ExpectedToolCall,
): void {
  const tol = expected.argsDateRangeTolerant!;
  const actualStart = actual.input.start;
  const actualEnd = actual.input.end;

  expect(
    typeof actualStart,
    `tool call (${expected.name}): missing or non-string "start" arg`,
  ).toBe('string');
  expect(
    typeof actualEnd,
    `tool call (${expected.name}): missing or non-string "end" arg`,
  ).toBe('string');

  const startDelta = daysBetween(tol.start, actualStart as string);
  const endDelta = daysBetween(tol.end, actualEnd as string);

  expect(
    Math.abs(startDelta),
    `tool call (${expected.name}): start "${actualStart}" is ${startDelta}d off expected "${tol.start}" (tolerance ${tol.toleranceDays}d)`,
  ).toBeLessThanOrEqual(tol.toleranceDays);
  expect(
    Math.abs(endDelta),
    `tool call (${expected.name}): end "${actualEnd}" is ${endDelta}d off expected "${tol.end}" (tolerance ${tol.toleranceDays}d)`,
  ).toBeLessThanOrEqual(tol.toleranceDays);

  // Verify other args (e.g. top_n) match exactly.
  if (tol.otherArgsExact) {
    for (const [key, value] of Object.entries(tol.otherArgsExact)) {
      expect(
        actual.input[key],
        `tool call (${expected.name}): other arg "${key}" mismatch`,
      ).toEqual(value);
    }
  }
}

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA + 'T00:00:00Z').getTime();
  const b = new Date(isoB + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

// ──────────────────────────────────────────────────────────────────────────────
// Answer-text expectations
// ──────────────────────────────────────────────────────────────────────────────

export interface AnswerConstraints {
  /** Substrings that MUST appear literally in the answer text. Case-sensitive
   *  unless you pre-lowercase. Each entry is a hard requirement — typically
   *  used for the dollar figure, customer name, count, or other calibrated
   *  values from CALIBRATED in fetcherFixtures.ts. */
  mustInclude?: string[];
  /** Substrings that MUST NOT appear. Used for voice/format guards: no
   *  markdown asterisks, no Stripe IDs (`sub_`, `cus_`, `ch_`), no raw cent
   *  values, no "as an AI" preambles, etc. */
  mustNotInclude?: string[];
  /** Hard cap on sentences. Counts terminal punctuation [.!?] followed by
   *  whitespace or end-of-string. */
  maxSentences?: number;
  /** Optional regex matchers for patterns rather than fixed strings. Each
   *  entry is "must match this regex at least once". */
  mustMatch?: RegExp[];
  /** Optional negative regex matchers. */
  mustNotMatch?: RegExp[];
}

export function expectAnswerConstraints(
  text: string,
  constraints: AnswerConstraints,
): void {
  if (constraints.mustInclude) {
    for (const needle of constraints.mustInclude) {
      expect(
        text.includes(needle),
        `answer missing required substring "${needle}". Got: ${truncate(text, 200)}`,
      ).toBe(true);
    }
  }

  if (constraints.mustNotInclude) {
    for (const needle of constraints.mustNotInclude) {
      expect(
        text.includes(needle),
        `answer contains forbidden substring "${needle}". Got: ${truncate(text, 200)}`,
      ).toBe(false);
    }
  }

  if (constraints.mustMatch) {
    for (const re of constraints.mustMatch) {
      expect(
        re.test(text),
        `answer failed required pattern ${re}. Got: ${truncate(text, 200)}`,
      ).toBe(true);
    }
  }

  if (constraints.mustNotMatch) {
    for (const re of constraints.mustNotMatch) {
      expect(
        re.test(text),
        `answer matched forbidden pattern ${re}. Got: ${truncate(text, 200)}`,
      ).toBe(false);
    }
  }

  if (constraints.maxSentences !== undefined) {
    const count = countSentences(text);
    expect(
      count,
      `answer has ${count} sentences, max allowed ${constraints.maxSentences}. Got: ${truncate(text, 200)}`,
    ).toBeLessThanOrEqual(constraints.maxSentences);
  }
}

function countSentences(text: string): number {
  // Count [.!?] terminators followed by whitespace or end-of-string.
  // Trims trailing whitespace first so the final period (no trailing space)
  // still counts.
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const matches = trimmed.match(/[.!?](?=\s|$)/g);
  return matches ? matches.length : 1;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

// ──────────────────────────────────────────────────────────────────────────────
// Eval case shape — what the case files export.
// ──────────────────────────────────────────────────────────────────────────────

export interface EvalCase {
  /** Human-readable test name; appears in Vitest output. */
  name: string;
  /** The user's question — sent verbatim as the user message. */
  question: string;
  /** Optional. Omit to skip tool-call assertions entirely (use for cases
   *  where tool selection is intentionally non-deterministic, e.g. open-ended
   *  voice torture tests). */
  expectTools?: ExpectedToolCall[];
  /** Optional. Omit to skip answer-text assertions. */
  expectAnswer?: AnswerConstraints;
}
