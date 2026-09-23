// Shared metric building blocks. Per the 5b kickoff design:
//   - Inputs: per-metric TS interfaces (S2-A, Option A revision — Zod runtime
//     schemas arrive with V3 tool wrappers, not in V2 function files).
//   - Outputs: discriminated union (S3-A) — every metric tags `kind: 'scalar' | 'rows'`.
//   - `now` injected as Date, never read internally (S5-A) — matches resolveDateExpression pattern.
//   - Money in major units; per-currency rows for primitives (S4-C).

export interface Period {
  start: number;
  end: number;
}

export type CurrencyCode = string; // ISO 4217 lowercase, per Stripe convention

// Stripe minor-unit divisor per ISO 4217.
//   Zero-decimal currencies bill in whole units (¥100 = 100 units, not 10,000).
//   Three-decimal currencies bill in thousandths.
//   Source: https://docs.stripe.com/currencies#zero-decimal
const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf',
  'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

export function minorUnitDivisor(currency: string): number {
  const c = currency.toLowerCase();
  if (ZERO_DECIMAL.has(c)) return 1;
  if (THREE_DECIMAL.has(c)) return 1000;
  return 100;
}

export function toMajor(amountMinor: number, currency: string): number {
  return amountMinor / minorUnitDivisor(currency);
}

// ── 3B — Tabular result metadata ─────────────────────────────────────────────
//
// Tools opt into table rendering by attaching a `table` block to their
// `kind: 'rows'` result. Tools without `table` continue rendering as
// narrative (frontend default). Backward-compatible — adding the field
// to a primitive's output does not change behavior for any existing tool
// that doesn't ship its own column hints.
//
// Frontend renders Stripe Apps SDK <Table> using `columns[].field` as the
// row-property accessor and `columns[].format` as the cell renderer hint.
// Tool sort order is authoritative; `sort_default` is informational only
// (frontend respects it ONLY if rows aren't already pre-sorted by tool —
// most primitives sort their own output).

export type TableCellFormat =
  | 'currency'
  | 'date'
  | 'number'
  | 'percent'
  | 'text';

export interface TableColumn {
  /** Field name in the row object — must match a key in rows[0]. */
  field: string;
  /** Display label rendered in the table header cell. */
  label: string;
  /** Cell alignment, passes through to TableCell.align. Default 'left'. */
  align?: 'left' | 'center' | 'right';
  /** Cell rendering hint — frontend formats values per this hint. */
  format?: TableCellFormat;
  /** When format='currency' on a multi-currency table, names the row's
   *  currency-code field so the cell renderer can pull the per-row code
   *  (e.g. 'currency'). Otherwise omit and the renderer uses the
   *  table-level dominant currency or assumes USD. */
  currency_field?: string;
  /** Width hint, passes through to TableCell.maxWidth. */
  width?: 'auto' | 'minimized' | 'maximized' | number;
}

export interface TableMetadata {
  /** Column definitions in display order. */
  columns: TableColumn[];
  /** Optional default sort. Informational — primitives are responsible
   *  for sorting their own rows. */
  sort_default?: { field: string; order: 'asc' | 'desc' };
  /** Optional empty-state copy when rows.length === 0. Tool-specific
   *  ("No customers found", "No charges in this period") beats a generic
   *  fallback. */
  empty_label?: string;
}
