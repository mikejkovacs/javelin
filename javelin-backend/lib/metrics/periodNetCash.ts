// period_net_cash — "what hit the bank" — sum of balance_transaction.net for
// the allowlisted BT types in [period.start, period.end], per BT currency.
// Spec: Build plan/metric-definitions.md L314–L322.
//
// Gross minus Stripe per-charge processing fees minus refunds minus chargebacks.
// Filters strictly on bt.created IN period (M2.1-S3-C) — the co-fetched BT list
// is widened by the executor so charge_enriched can join tail-of-period charges,
// but this metric still windows by BT-native dates.
//
// BT type allowlist (M2.1-S2, strict per def doc): charge, refund, adjustment,
// payment_refund, dispute. Excludes stripe_fee, application_fee, payout,
// transfer, and other non-customer-flow BT types.
//
// Currency grouped by bt.currency (M2.1-S4) — the settlement currency, which
// is the bank-deposit view.

import type { StripeBalanceTransactionLike } from './chargeEnriched';
import { toMajor, type Period } from './types';

export interface PeriodNetCashRow {
  currency: string;
  net_cash: number;
  transaction_count: number;
}

export interface PeriodNetCashResult {
  kind: 'rows';
  rows: PeriodNetCashRow[];
  definition: 'stripe_balance_transaction.net_aggregation';
  as_of: number;
  period: Period;
}

export interface PeriodNetCashInput {
  balanceTransactions: StripeBalanceTransactionLike[];
  period: Period;
  now: Date;
}

// BT types that represent customer-money flow (gross, refunds, chargebacks,
// adjustments). Excludes Stripe service fees, Connect platform fees, payouts,
// transfers — those are not part of "what hit the bank from customer payments".
const ALLOWED_BT_TYPES = new Set([
  'charge',
  'refund',
  'adjustment',
  'payment_refund',
  'dispute',
]);

export function periodNetCash(input: PeriodNetCashInput): PeriodNetCashResult {
  const { balanceTransactions, period, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  const buckets = new Map<string, { net_cash_minor: number; transaction_count: number }>();
  for (const bt of balanceTransactions) {
    if (!ALLOWED_BT_TYPES.has(bt.type)) continue;
    if (bt.created < period.start || bt.created > period.end) continue;
    const bucket = buckets.get(bt.currency) ?? { net_cash_minor: 0, transaction_count: 0 };
    bucket.net_cash_minor += bt.net;
    bucket.transaction_count += 1;
    buckets.set(bt.currency, bucket);
  }

  const rows = Array.from(buckets.entries())
    .map(([currency, b]) => ({
      currency,
      net_cash: toMajor(b.net_cash_minor, currency),
      transaction_count: b.transaction_count,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    kind: 'rows',
    rows,
    definition: 'stripe_balance_transaction.net_aggregation',
    as_of: nowSec,
    period,
  };
}
