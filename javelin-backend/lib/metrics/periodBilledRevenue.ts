// period_billed_revenue — sum of invoice_enriched.subtotal where
// status IN (paid, open, uncollectible) AND finalized_at IN dateRange.
// Spec: Build plan/metric-definitions.md L282–L294.
//
// Default uses `subtotal` (post-discount, pre-tax — RevRec recognizable portion).
// Sibling metric period_billed_revenue_inclusive_of_tax uses `total` instead.
//
// Excludes: voided invoices and draft invoices (no finalized_at).
// Date field: finalized_at per RevRec methodology — the "billed on" event.

import { invoiceEnriched, type StripeInvoiceLike } from './invoiceEnriched';
import type { Period } from './types';

export interface PeriodBilledRevenueRow {
  currency: string;
  billed_revenue: number;
  invoice_count: number;
}

export interface PeriodBilledRevenueResult {
  kind: 'rows';
  rows: PeriodBilledRevenueRow[];
  definition:
    | 'stripe_revenue_recognition.period_billed_revenue'
    | 'stripe_revenue_recognition.period_billed_revenue_inclusive_of_tax';
  as_of: number;
  period: Period;
  basis: 'subtotal' | 'total';
}

export interface PeriodBilledRevenueInput {
  invoices: StripeInvoiceLike[];
  period: Period;
  now: Date;
}

const BILLED_STATUSES = new Set(['paid', 'open', 'uncollectible']);

function compute(
  input: PeriodBilledRevenueInput,
  basis: 'subtotal' | 'total'
): PeriodBilledRevenueResult {
  const { invoices, period, now } = input;
  const enriched = invoiceEnriched({ invoices, now });

  const buckets = new Map<string, { billed_revenue: number; invoice_count: number }>();
  for (const row of enriched.rows) {
    if (!BILLED_STATUSES.has(row.status)) continue;
    if (row.finalized_at == null) continue;
    if (row.finalized_at < period.start || row.finalized_at > period.end) continue;
    const bucket = buckets.get(row.currency) ?? { billed_revenue: 0, invoice_count: 0 };
    bucket.billed_revenue += basis === 'subtotal' ? row.subtotal : row.total;
    bucket.invoice_count += 1;
    buckets.set(row.currency, bucket);
  }

  const rows = Array.from(buckets.entries())
    .map(([currency, b]) => ({ currency, ...b }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    kind: 'rows',
    rows,
    definition:
      basis === 'subtotal'
        ? 'stripe_revenue_recognition.period_billed_revenue'
        : 'stripe_revenue_recognition.period_billed_revenue_inclusive_of_tax',
    as_of: enriched.as_of,
    period,
    basis,
  };
}

export function periodBilledRevenue(input: PeriodBilledRevenueInput): PeriodBilledRevenueResult {
  return compute(input, 'subtotal');
}

export function periodBilledRevenueInclusiveOfTax(
  input: PeriodBilledRevenueInput
): PeriodBilledRevenueResult {
  return compute(input, 'total');
}
