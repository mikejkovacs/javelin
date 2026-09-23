// charge_enriched — one row per charge with derived columns for segmentation.
// Spec: Build plan/metric-definitions.md L160–L186.
//
// Input: raw charges list + balance_transactions list (co-fetched by the executor
// in a widened window per M2.1-S3-C). We join bt to charge in-memory by
// charge.balance_transaction === bt.id — avoids the charge.balance_transaction
// expand which would bloat per-charge payload size.

import { toMajor } from './types';

// ── Structural Stripe shape (minimal subset we read) ─────────────────────────

export interface StripeChargeLike {
  id: string;
  customer: string | { id: string } | null;
  amount: number;
  amount_refunded: number;
  currency: string;
  status: 'succeeded' | 'pending' | 'failed';
  created: number;
  disputed: boolean;
  refunded: boolean;
  balance_transaction: string | { id: string } | null;
  /** Stripe sets this when the charge was created to pay an invoice;
   *  null/absent for direct charges. Optional — chargeEnriched doesn't
   *  read it, but L2's `monthly_collected_charges_series` needs it to
   *  exclude invoice-paying charges (avoiding double-count with billed
   *  revenue). */
  invoice?: string | null;
  payment_method_details?: {
    card?: {
      brand?: string | null;
      country?: string | null;
    } | null;
  } | null;
  billing_details?: {
    address?: {
      country?: string | null;
    } | null;
    /** Email captured on the payment method (not necessarily matching
     *  the linked Customer's email). Used by `failed_payments` for top
     *  failure display_name when no Customer record is linked. */
    email?: string | null;
    /** Cardholder name from the payment method. Same usage. */
    name?: string | null;
  } | null;
  /** Stripe surfaces fraud signals on the charge via `fraud_details`.
   *  `user_report` is set when the merchant marks a charge fraudulent
   *  in the Dashboard; `stripe_report` is set by Stripe's internal
   *  systems. Either being 'fraudulent' is the canonical signal we use
   *  for the M2 Phase 2A `exclude_fraud` filter. */
  fraud_details?: {
    user_report?: string | null;
    stripe_report?: string | null;
  } | null;
  /** Stripe sets these on `status='failed'` charges. `failure_code` is the
   *  high-level error code (e.g. 'card_declined', 'expired_card',
   *  'insufficient_funds'); `outcome.reason` is the more specific decline
   *  reason. Used by the M2 Phase 2C-pre `failed_payments` tool to bucket
   *  failure reasons for operator narration. */
  failure_code?: string | null;
  outcome?: {
    reason?: string | null;
    network_status?: string | null;
    type?: string | null;
  } | null;
}

export interface StripeBalanceTransactionLike {
  id: string;
  fee: number;
  net: number;
  currency: string;
  type: string;
  created: number;
}

// ── Output shape (per def doc L167–L183) ──────────────────────────────────────

export interface ChargeEnrichedRow {
  charge_id: string;
  customer_id: string | null;
  amount: number;              // major units, gross
  amount_refunded: number;     // major units
  net_collected: number;       // amount − amount_refunded, major units
  currency: string;
  status: 'succeeded' | 'pending' | 'failed';
  created_at: number;
  card_brand: string | null;
  card_country: string | null;
  billing_country: string | null;
  disputed: boolean;
  refunded: boolean;
  fee: number | null;          // major units, from joined BT
  net: number | null;          // major units, from joined BT
  is_fraudulent: boolean;      // user_report or stripe_report = 'fraudulent'
}

export interface ChargeEnrichedResult {
  kind: 'rows';
  rows: ChargeEnrichedRow[];
  definition: 'javelin.charge_enriched.v1';
  as_of: number;
}

export interface ChargeEnrichedInput {
  charges: StripeChargeLike[];
  balanceTransactions: StripeBalanceTransactionLike[];
  now: Date;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function customerId(c: StripeChargeLike['customer']): string | null {
  if (c == null) return null;
  return typeof c === 'string' ? c : c.id;
}

function btId(b: StripeChargeLike['balance_transaction']): string | null {
  if (b == null) return null;
  return typeof b === 'string' ? b : b.id;
}

function deriveIsFraudulent(ch: StripeChargeLike): boolean {
  const fd = ch.fraud_details;
  if (!fd) return false;
  return (
    fd.user_report === 'fraudulent' || fd.stripe_report === 'fraudulent'
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function chargeEnriched(input: ChargeEnrichedInput): ChargeEnrichedResult {
  const { charges, balanceTransactions, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  // Index BTs by id for O(1) join.
  const btById = new Map<string, StripeBalanceTransactionLike>();
  for (const bt of balanceTransactions) {
    btById.set(bt.id, bt);
  }

  const rows = charges.map((ch): ChargeEnrichedRow => {
    const linkedBtId = btId(ch.balance_transaction);
    const bt = linkedBtId ? btById.get(linkedBtId) : undefined;

    const amount = toMajor(ch.amount, ch.currency);
    const amount_refunded = toMajor(ch.amount_refunded, ch.currency);

    // BT fee/net are in the BT's settlement currency (may differ from charge
    // currency on cross-currency charges); convert using BT's currency.
    const fee = bt ? toMajor(bt.fee, bt.currency) : null;
    const net = bt ? toMajor(bt.net, bt.currency) : null;

    return {
      charge_id: ch.id,
      customer_id: customerId(ch.customer),
      amount,
      amount_refunded,
      net_collected: amount - amount_refunded,
      currency: ch.currency,
      status: ch.status,
      created_at: ch.created,
      card_brand: ch.payment_method_details?.card?.brand ?? null,
      card_country: ch.payment_method_details?.card?.country ?? null,
      billing_country: ch.billing_details?.address?.country ?? null,
      disputed: ch.disputed,
      refunded: ch.refunded,
      fee,
      net,
      is_fraudulent: deriveIsFraudulent(ch),
    };
  });

  return {
    kind: 'rows',
    rows,
    definition: 'javelin.charge_enriched.v1',
    as_of: nowSec,
  };
}
