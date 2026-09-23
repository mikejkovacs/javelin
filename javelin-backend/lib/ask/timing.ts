// Latency instrumentation helpers — emits structured `[TIMING]` log lines
// that are grep-able in Vercel logs.
//
// Why this exists: Merchant A dogfood landed in seconds-to-tens-of-seconds,
// but the first beta merchant's first question took 3-4 minutes (Merchant B
// Studio, 2026-05-12). Without per-segment timing we can't tell whether the
// time lived in fetcher pagination, model turn latency, or somewhere else.
// This module is logging-only — zero behavior change to fetchers, tools, or
// the /api/ask handler.
//
// Output shape (one line per event):
//   [TIMING] <event> {"key":"value", ...}
//
// Events emitted today:
//   request_start    — POST /api/ask received
//   auth_done        — signature verification complete
//   db_setup_done    — thread upsert/ownership/insert/touch/hydrate complete
//   stream_started   — streamText() called (TTFB approximation)
//   tool_end         — a tool's execute() resolved (or errored)
//   fetcher_end      — a fetcher's autoPaging completed (or errored)
//   request_end      — onFinish fired (success path)
//
// Safe for Edge runtime: only uses Date.now() and console.log.

export function logTiming(event: string, fields: Record<string, unknown>): void {
  // Single-line JSON payload after the event tag so a `grep [TIMING]` plus
  // `jq` (or eyeballing) gets a clean stream of structured events.
  console.log(`[TIMING] ${event} ${JSON.stringify(fields)}`);
}

/**
 * Wrap an async function with start/end timing. Preserves the original
 * signature (the cast through `unknown` is the standard TS pattern for HOFs
 * that pass arbitrary args).
 *
 * `kind` distinguishes log lines so a single grep filter can separate
 * fetcher-level from tool-level timings:
 *   `grep '[TIMING] fetcher_end'`   → just fetchers
 *   `grep '[TIMING] tool_end'`      → just tools
 *
 * On error: emits `<kind>_error` with the elapsed time, then re-throws so
 * upstream behavior (the existing try/catch in tool execute() blocks) is
 * unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withTiming<F extends (...args: any[]) => Promise<any>>(
  label: string,
  kind: 'fetcher' | 'tool',
  fn: F,
): F {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (async (...args: any[]) => {
    const t0 = Date.now();
    try {
      const result = await fn(...args);
      const duration_ms = Date.now() - t0;
      logTiming(`${kind}_end`, {
        [kind]: label,
        duration_ms,
        rows: extractRowCount(result),
      });
      return result;
    } catch (err) {
      const duration_ms = Date.now() - t0;
      logTiming(`${kind}_error`, {
        [kind]: label,
        duration_ms,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }) as F;
}

/**
 * Best-effort row-count extractor for fetcher results so the timing line
 * carries a sense of "how much data did this paginate". Stays undefined
 * (omitted from JSON) for non-list-shaped results.
 */
function extractRowCount(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    // Known wrapper shapes used by fetchers: { transactions, truncated },
    // { charges, truncated }, { matches, truncated }
    for (const key of ['transactions', 'charges', 'matches', 'invoices', 'data']) {
      if (Array.isArray(r[key])) return (r[key] as unknown[]).length;
    }
  }
  return undefined;
}
