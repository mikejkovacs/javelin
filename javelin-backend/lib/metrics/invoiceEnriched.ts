// invoice_enriched — one row per invoice with derived "billed" amounts.
// Spec: Build plan/metric-definitions.md L188–L218.
//
// Field mapping note (M2.2-S1): the def doc's `subtotal` column is "post-discount,
// pre-tax" which corresponds to Stripe's `total_excluding_tax`, NOT Stripe's
// `subtotal` (which is pre-discount). We read `total_excluding_tax` here so the
// row column matches the def doc semantic (RevRec recognizable portion).

import { toMajor } from './types';

// ── Structural Stripe shape ──────────────────────────────────────────────────

export interface StripeInvoiceLineItemLike {
  /** Per-line amount in minor units, post-discount, pre-tax. Optional —
   *  invoiceEnriched doesn't read it (we use invoice-level subtotal), but
   *  L2's `monthly_recurring_billed_series` needs per-line amounts to
   *  isolate the recurring portion of mixed invoices, and Phase 2C-post-v2's
   *  `revenue_by_plan_billed` sums it per-plan for the billed-side breakdown. */
  amount?: number;
  /** Per-line currency (typically matches invoice.currency but populated
   *  per-line on multi-currency line items). Optional. */
  currency?: string;
  /** LEGACY shape — Stripe API versions before the 2024-2025 line item
   *  restructure carry the price details directly on `line.price`. The new
   *  API replaces this with `line.pricing.price_details.*` (see below). The
   *  fixture uses legacy shape so existing eval cases pass; production data
   *  on newer API versions uses the new shape. Phase 2C-post-v2 reads BOTH
   *  defensively. */
  price?: {
    id: string;
    product: string | { id: string; name?: string | null };
    /** Optional — populated when invoices are fetched with `expand:
     *  ['data.lines.data.price']` (added 2026-04-30 for revenue_by_plan).
     *  Falls back to product.name (if expanded) then 'unattributed' when
     *  null/absent. */
    nickname?: string | null;
    /** Optional — present on recurring prices, absent on one-time prices.
     *  L2 uses this to filter line items to the recurring portion. */
    recurring?: {
      interval: 'day' | 'week' | 'month' | 'year';
      interval_count: number;
    } | null;
  } | null;
  /** NEW shape — Stripe API versions on the 2024-2025 invoice line item
   *  restructure put price details under `line.pricing.price_details.*`.
   *  `line.price` is NOT populated on the new shape. Phase 2C-post diagnostic
   *  2026-05-11 confirmed against Merchant A production data. */
  pricing?: {
    price_details?: {
      price?: string;          // Price ID (was line.price.id in legacy)
      product?: string;        // Product ID (was line.price.product in legacy)
    } | null;
    /** Stripe's published key on line.pricing — 'recurring' vs 'one_time'. */
    type?: 'recurring' | 'one_time' | string | null;
    unit_amount_decimal?: string | null;
  } | null;
}

export interface StripeInvoiceLike {
  id: string;
  customer: string | { id: string } | null;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void' | null;
  total: number;
  subtotal: number;
  total_excluding_tax: number | null;
  tax: number | null;
  amount_paid: number;
  amount_due: number;
  amount_remaining: number;
  currency: string;
  created: number;
  /** Stripe increments this when an automatic payment attempt fails on
   *  an invoice. Used by `failed_payments` to detect failed invoice
   *  attempts (`attempt_count > 0` AND status in {'open', 'uncollectible'}). */
  attempt_count?: number | null;
  status_transitions?: {
    finalized_at: number | null;
    paid_at: number | null;
    voided_at: number | null;
    marked_uncollectible_at: number | null;
  } | null;
  lines: { data: StripeInvoiceLineItemLike[] };
}

// ── Output shape ─────────────────────────────────────────────────────────────

export interface InvoiceEnrichedRow {
  invoice_id: string;
  customer_id: string | null;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  total: number;                 // major units, post-discount + tax
  subtotal: number;              // major units, post-discount, pre-tax (= total_excluding_tax)
  tax: number;                   // major units
  amount_paid: number;
  amount_due: number;
  amount_remaining: number;
  currency: string;
  created_at: number;
  finalized_at: number | null;
  paid_at: number | null;
  voided_at: number | null;
  marked_uncollectible_at: number | null;
  product_ids: string[];
  price_ids: string[];
}

export interface InvoiceEnrichedResult {
  kind: 'rows';
  rows: InvoiceEnrichedRow[];
  definition: 'javelin.invoice_enriched.v1';
  as_of: number;
}

export interface InvoiceEnrichedInput {
  invoices: StripeInvoiceLike[];
  now: Date;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function customerId(c: StripeInvoiceLike['customer']): string | null {
  if (c == null) return null;
  return typeof c === 'string' ? c : c.id;
}

function productId(p: StripeInvoiceLineItemLike['price'] extends infer P ? P : never): string | null {
  if (p == null) return null;
  return typeof p.product === 'string' ? p.product : p.product.id;
}

/** Dual-shape line → priceId/productId resolution. Phase 2D-followup
 *  (PCL "$375 vs $371 drift investigation"): on Stripe's new API,
 *  `line.price` is null and price details live under `line.pricing.price_details`.
 *  This helper reads BOTH shapes defensively. Returns { priceId, productId }
 *  with null for whichever isn't resolvable. */
function lineRefs(line: StripeInvoiceLineItemLike): {
  priceId: string | null;
  productId: string | null;
} {
  // Legacy shape
  if (line.price) {
    return {
      priceId: line.price.id,
      productId: productId(line.price),
    };
  }
  // New shape
  if (line.pricing?.price_details) {
    return {
      priceId: line.pricing.price_details.price ?? null,
      productId: line.pricing.price_details.product ?? null,
    };
  }
  return { priceId: null, productId: null };
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function invoiceEnriched(input: InvoiceEnrichedInput): InvoiceEnrichedResult {
  const { invoices, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  const rows = invoices.map((inv): InvoiceEnrichedRow => {
    // Per M2.2-S1: prefer total_excluding_tax (post-discount, pre-tax). Fall back
    // to Stripe's `subtotal` only if the field is absent (older API versions).
    const subtotalMinor = inv.total_excluding_tax ?? inv.subtotal;
    const productIds = new Set<string>();
    const priceIds = new Set<string>();
    for (const line of inv.lines.data) {
      const { priceId, productId: pid } = lineRefs(line);
      if (priceId) priceIds.add(priceId);
      if (pid) productIds.add(pid);
    }

    return {
      invoice_id: inv.id,
      customer_id: customerId(inv.customer),
      status: (inv.status ?? 'draft') as InvoiceEnrichedRow['status'],
      total: toMajor(inv.total, inv.currency),
      subtotal: toMajor(subtotalMinor, inv.currency),
      tax: toMajor(inv.tax ?? 0, inv.currency),
      amount_paid: toMajor(inv.amount_paid, inv.currency),
      amount_due: toMajor(inv.amount_due, inv.currency),
      amount_remaining: toMajor(inv.amount_remaining, inv.currency),
      currency: inv.currency,
      created_at: inv.created,
      finalized_at: inv.status_transitions?.finalized_at ?? null,
      paid_at: inv.status_transitions?.paid_at ?? null,
      voided_at: inv.status_transitions?.voided_at ?? null,
      marked_uncollectible_at: inv.status_transitions?.marked_uncollectible_at ?? null,
      product_ids: Array.from(productIds),
      price_ids: Array.from(priceIds),
    };
  });

  return {
    kind: 'rows',
    rows,
    definition: 'javelin.invoice_enriched.v1',
    as_of: nowSec,
  };
}
