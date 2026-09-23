// failed_payments — failed charges + failed invoice payment attempts
// aggregated for a date period.
//
// M2 Phase 2C-pre (locked 2026-05-08). Closes the dogfood-validated
// capability gap where Javelin couldn't answer "what were my failed
// payments in March?" — Stripe Dashboard surfaces this clearly but
// we previously had no tool that filtered charges by failure status.
//
// Definition tag: `javelin_defined.failed_payments` — composes two
// Stripe data streams (charges and invoices) into a unified
// "money the customer tried to send you but didn't successfully arrive"
// aggregate. No Stripe-canonical primitive exists; closest reference is
// the Stripe Dashboard's "Failed payments" panel + the Payments stat row.
//
// What's IN scope:
//   - Failed charges (charge.status === 'failed')
//   - Failed invoice payment attempts (invoice.attempt_count > 0 AND
//     invoice.status in {'open', 'uncollectible'}). Note: Stripe's invoice
//     status enum has no 'past_due' value — that's a subscription state,
//     not an invoice state. 'open' covers unpaid finalized invoices that
//     are past due; 'uncollectible' covers ones the merchant gave up on.
//
// What's OUT of scope (deliberately):
//   - Lost disputes / chargebacks (already counted by period_net_revenue.chargebacks)
//   - Refunds (intentional reversals)
//   - Involuntary churn dollar value (separate concern, derivable via churn_count + MRR)

import type { StripeChargeLike } from './chargeEnriched';
import type { StripeInvoiceLike } from './invoiceEnriched';
import type { Period } from './types';
import { toMajor } from './types';

// ── Operator-friendly failure-reason buckets ────────────────────────────────
// Maps Stripe's ~30 raw failure_code / outcome.reason values into 7
// operator-friendly categories. Default: 'other'. Categorical breakdown
// surfaces in result.failure_reasons (top 3 by count).
const FAILURE_REASON_BUCKETS: Record<string, string> = {
  // Insufficient funds
  insufficient_funds: 'insufficient_funds',

  // Expired card
  expired_card: 'expired_card',

  // Card declined / generic
  card_declined: 'card_declined',
  do_not_honor: 'card_declined',
  generic_decline: 'card_declined',
  transaction_not_allowed: 'card_declined',

  // Stolen / lost / fraud-flag declines
  lost_card: 'stolen_or_lost_card',
  stolen_card: 'stolen_or_lost_card',
  fraudulent: 'stolen_or_lost_card',
  pickup_card: 'stolen_or_lost_card',

  // Authentication / verification failures
  authentication_required: 'authentication_failed',
  incorrect_cvc: 'authentication_failed',
  incorrect_zip: 'authentication_failed',
  incorrect_number: 'authentication_failed',
  invalid_account: 'authentication_failed',
  invalid_cvc: 'authentication_failed',
  invalid_expiry_year: 'authentication_failed',
  invalid_expiry_month: 'authentication_failed',
  invalid_number: 'authentication_failed',

  // Processing / network errors
  processing_error: 'processing_error',
  service_unavailable: 'processing_error',
  call_issuer: 'processing_error',
  try_again_later: 'processing_error',
};

function bucketFailureReason(charge: StripeChargeLike): string {
  // Prefer outcome.reason (more specific), fall back to failure_code.
  const reason = charge.outcome?.reason ?? charge.failure_code ?? null;
  if (!reason) return 'other';
  return FAILURE_REASON_BUCKETS[reason] ?? 'other';
}

// ── Result shape ────────────────────────────────────────────────────────────

export interface FailedPaymentsRow {
  currency: string;
  total_failed: number;
  count: number;
  breakdown: {
    failed_charges: { amount: number; count: number };
    failed_invoice_attempts: { amount: number; count: number };
  };
}

export interface FailedPaymentEntry {
  customer_display_name: string;
  amount: number;
  currency: string;
  occurred_at_iso: string;
  failure_type: 'charge' | 'invoice_attempt';
  /** Operator-friendly category (e.g. 'insufficient_funds'). Only present
   *  on charge-side failures; invoice attempts don't expose granular
   *  failure reasons in the same way. */
  failure_reason_category?: string;
}

export interface FailureReasonBucketRow {
  category: string;
  count: number;
  total_amount: number;
}

export interface FailedPaymentsResult {
  kind: 'rows';
  rows: FailedPaymentsRow[];
  /** Top-N largest individual failures by amount, sorted desc.
   *  Defaults to 5; configurable via input.topN (max 20). */
  top_failures: FailedPaymentEntry[];
  /** Top-3 failure-reason buckets by count, charge-side only.
   *  Empty when no charge-side failures or all reasons resolve to 'other'. */
  failure_reasons: FailureReasonBucketRow[];
  definition: 'javelin_defined.failed_payments';
  as_of: number;
  period: Period;
  /** True when one of the underlying fetchers hit its pagination cap. */
  truncated: boolean;
}

export interface FailedPaymentsInput {
  charges: StripeChargeLike[];
  /** Already filtered to invoices with non-draft status; primitive applies
   *  the failed-attempt filter (`attempt_count > 0` + status check). */
  invoices: StripeInvoiceLike[];
  period: Period;
  now: Date;
  /** Default 5, max 20. */
  topN?: number;
  /** Pass-through from the underlying fetchers. */
  truncated?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function customerDisplayName(charge: StripeChargeLike): string {
  // Prefer billing_details.email/name — populated on completed charges
  // (including guest checkouts). NEVER return the raw Stripe customer ID —
  // CRITICAL RULE #3 forbids the LLM from rendering Stripe IDs in output,
  // and we don't want this primitive to put them on a tee.
  const email = charge.billing_details?.email;
  if (email && email.trim().length > 0) return email;
  const name = charge.billing_details?.name;
  if (name && name.trim().length > 0) return name;
  return 'a guest customer';
}

function isoDateUTC(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function inPeriod(unixSec: number | null | undefined, period: Period): boolean {
  if (unixSec == null) return false;
  return unixSec >= period.start && unixSec <= period.end;
}

// 'open' = unpaid finalized invoice (covers past-due cases).
// 'uncollectible' = merchant marked the invoice unrecoverable.
// Drafts, paid, void all excluded.
const FAILED_INVOICE_STATUSES = new Set(['open', 'uncollectible']);

// ── Main ─────────────────────────────────────────────────────────────────────

export function failedPayments(input: FailedPaymentsInput): FailedPaymentsResult {
  const { charges, invoices, period, now, topN = 5, truncated = false } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  // Per-currency aggregation buckets.
  type Bucket = {
    failed_charges: { amount: number; count: number };
    failed_invoice_attempts: { amount: number; count: number };
  };
  const byCurrency = new Map<string, Bucket>();
  const getBucket = (currency: string): Bucket => {
    let b = byCurrency.get(currency);
    if (!b) {
      b = {
        failed_charges: { amount: 0, count: 0 },
        failed_invoice_attempts: { amount: 0, count: 0 },
      };
      byCurrency.set(currency, b);
    }
    return b;
  };

  // Top-N candidate accumulator (across charge + invoice).
  const candidates: FailedPaymentEntry[] = [];

  // Failure-reason category accumulator (charge-side only).
  const reasonBuckets = new Map<string, { count: number; total_amount: number }>();
  const bumpReason = (category: string, amount: number) => {
    const b = reasonBuckets.get(category) ?? { count: 0, total_amount: 0 };
    b.count += 1;
    b.total_amount += amount;
    reasonBuckets.set(category, b);
  };

  // ── Charge-side failures ──────────────────────────────────────────────────
  for (const charge of charges) {
    if (charge.status !== 'failed') continue;
    if (!inPeriod(charge.created, period)) continue;

    const amountMajor = toMajor(charge.amount, charge.currency);
    const bucket = getBucket(charge.currency);
    bucket.failed_charges.amount += amountMajor;
    bucket.failed_charges.count += 1;

    const category = bucketFailureReason(charge);
    bumpReason(category, amountMajor);

    candidates.push({
      customer_display_name: customerDisplayName(charge),
      amount: amountMajor,
      currency: charge.currency,
      occurred_at_iso: isoDateUTC(charge.created),
      failure_type: 'charge',
      failure_reason_category: category,
    });
  }

  // ── Invoice-side failures ─────────────────────────────────────────────────
  for (const invoice of invoices) {
    const attemptCount = invoice.attempt_count ?? 0;
    if (attemptCount <= 0) continue;
    if (!invoice.status || !FAILED_INVOICE_STATUSES.has(invoice.status)) continue;

    // Date attribution: use status_transitions.finalized_at when present
    // (the finalized invoice is when payment attempts began);
    // fall back to created if not finalized.
    const dateRef =
      invoice.status_transitions?.finalized_at ??
      invoice.created ??
      null;
    if (!inPeriod(dateRef, period)) continue;

    const amountMajor = toMajor(invoice.total ?? 0, invoice.currency);
    if (amountMajor <= 0) continue; // skip zero-total or credit invoices

    const bucket = getBucket(invoice.currency);
    bucket.failed_invoice_attempts.amount += amountMajor;
    bucket.failed_invoice_attempts.count += 1;

    candidates.push({
      // No name fallback path on invoice (StripeInvoiceLike has only the
      // customer ID). Use 'an unnamed customer' rather than the raw ID
      // (Rule #3 — never render cus_ IDs to the LLM output stream).
      customer_display_name: 'an unnamed customer',
      amount: amountMajor,
      currency: invoice.currency,
      occurred_at_iso: isoDateUTC(dateRef!),
      failure_type: 'invoice_attempt',
      // No failure_reason_category for invoice attempts — Stripe doesn't
      // surface granular reasons at the invoice level the way it does on
      // charge.failure_code. PaymentIntent.last_payment_error.code carries
      // it but requires a per-invoice fetch we don't do here.
    });
  }

  // Build per-currency rows.
  const rows: FailedPaymentsRow[] = Array.from(byCurrency.entries())
    .map(([currency, b]) => ({
      currency,
      total_failed: b.failed_charges.amount + b.failed_invoice_attempts.amount,
      count: b.failed_charges.count + b.failed_invoice_attempts.count,
      breakdown: b,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  // Top-N failures by amount across currencies.
  // Note: we sort by amount without FX conversion — multi-currency merchants
  // may see ordering that doesn't reflect equivalent dollar value, but
  // single-currency merchants (the common case) get accurate ranking.
  const cappedTopN = Math.max(1, Math.min(topN, 20));
  const top_failures = candidates
    .sort((a, b) => b.amount - a.amount)
    .slice(0, cappedTopN);

  // Top-3 failure-reason buckets by count (charge-side only).
  // Drop the catch-all 'other' if it's not in the top 3 organically — surface
  // only meaningful operator categories. Keep 'other' if it IS top 3 (means
  // most reasons are unmapped, which is itself useful operator signal).
  const failure_reasons = Array.from(reasonBuckets.entries())
    .map(([category, b]) => ({ category, count: b.count, total_amount: b.total_amount }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    kind: 'rows',
    rows,
    top_failures,
    failure_reasons,
    definition: 'javelin_defined.failed_payments',
    as_of: nowSec,
    period,
    truncated,
  };
}
