// account_balance — snapshot of /v1/balance with pending-settlement breakdown.
//
// Definition tag: `stripe_canonical.balance_object`. Mirrors Stripe's Balance
// surface verbatim — `available` is "ready for immediate transfer or payout",
// `pending` is "still processing; not yet spendable", `instant_available` is
// the subset eligible for Instant Payouts.
//
// Scope (Chunk B / 1D / Q1.2): only `available`, `pending`, and (when non-null)
// `instant_available` are surfaced. `connect_reserved` and `issuing` are
// dropped — the Javelin V2 ICP doesn't span Connect platforms or Issuing
// card programs. Add when an ICP merchant has those scopes.
//
// `source_types` breakdown (card / bank_account / fpx) is intentionally NOT
// surfaced (Q2.1) — the "why is part of my balance pending" question is
// answered better by the per-row `pending_settlement_breakdown` below than
// by source-type bucketing.
//
// Pending-settlement breakdown (Q3 / Option 1): when `pending` is non-zero,
// we group the merchant's currently-pending balance_transactions by
// `available_on` date (Stripe's settlement clock per row) so the LLM can
// answer "when does my pending balance become available" with a per-date
// schedule. Sorted ascending — next-to-settle first.

import type Stripe from 'stripe';
import { toMajor } from './types';

export interface AccountBalanceInput {
  balance: Stripe.Balance;
  pendingTransactions: Stripe.BalanceTransaction[]; // status === 'pending', any currency
  now: Date;
}

export interface BalanceSurfaceRow {
  currency: string; // ISO 4217 lowercase
  amount: number;   // major units
}

export interface PendingSettlementRow {
  available_on: string; // ISO date 'YYYY-MM-DD' (UTC)
  currency: string;     // ISO 4217 lowercase
  amount: number;       // major units, sum of `net` for rows with this (available_on, currency)
  count: number;        // number of pending balance_transactions in this bucket
}

export interface AccountBalanceResult {
  available: BalanceSurfaceRow[];
  pending: BalanceSurfaceRow[];
  instant_available: BalanceSurfaceRow[] | null; // null when Stripe returns null for the surface
  pending_settlement_breakdown: PendingSettlementRow[];
  definition: 'stripe_canonical.balance_object';
  as_of: number; // unix seconds
}

function surfaceRows(
  surface: Array<{ amount: number; currency: string }> | undefined | null,
): BalanceSurfaceRow[] {
  if (!surface) return [];
  return surface
    .map((row) => ({
      currency: row.currency.toLowerCase(),
      amount: toMajor(row.amount, row.currency),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function isoDateUTC(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

export function accountBalance(input: AccountBalanceInput): AccountBalanceResult {
  const { balance, pendingTransactions, now } = input;

  const available = surfaceRows(balance.available);
  const pending = surfaceRows(balance.pending);
  const instant_available = balance.instant_available
    ? surfaceRows(balance.instant_available)
    : null;

  // Group currently-pending balance_transactions by (available_on, currency).
  // Sum `net` (post-fee, what actually moves to available). Same minor-unit
  // rules as the surface arrays above.
  const bucketKey = (row: Stripe.BalanceTransaction) =>
    `${isoDateUTC(row.available_on)}|${row.currency.toLowerCase()}`;

  const buckets = new Map<
    string,
    { available_on: string; currency: string; net_minor: number; count: number }
  >();

  for (const txn of pendingTransactions) {
    if (txn.status !== 'pending') continue;
    const key = bucketKey(txn);
    const existing = buckets.get(key) ?? {
      available_on: isoDateUTC(txn.available_on),
      currency: txn.currency.toLowerCase(),
      net_minor: 0,
      count: 0,
    };
    existing.net_minor += txn.net;
    existing.count += 1;
    buckets.set(key, existing);
  }

  const pending_settlement_breakdown: PendingSettlementRow[] = [];
  for (const b of buckets.values()) {
    pending_settlement_breakdown.push({
      available_on: b.available_on,
      currency: b.currency,
      amount: toMajor(b.net_minor, b.currency),
      count: b.count,
    });
  }
  // Sort ascending by available_on (next-to-settle first), then by currency
  // for deterministic ordering within a date.
  pending_settlement_breakdown.sort((a, b) => {
    if (a.available_on !== b.available_on) {
      return a.available_on < b.available_on ? -1 : 1;
    }
    return a.currency < b.currency ? -1 : 1;
  });

  return {
    available,
    pending,
    instant_available,
    pending_settlement_breakdown,
    definition: 'stripe_canonical.balance_object',
    as_of: Math.floor(now.getTime() / 1000),
  };
}
