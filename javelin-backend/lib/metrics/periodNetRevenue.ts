// period_net_revenue — gross_collected − refunds − chargebacks, per currency.
// Spec: Build plan/metric-definitions.md L306–L312.
//
// Formula (minor units → major units, grouped by currency):
//   sum(charge.amount where status = 'succeeded' AND created IN dateRange)
//   − sum(charge.amount_refunded where same)
//   − sum(dispute.amount where status IN ('lost','warning_closed') AND dispute.created IN dateRange)
//
// Dispute date field: dispute.created (M2.1-S1) — loss recognized in the period
// the dispute outcome lands, not when the original charge was made.
//
// Stripe fees NOT subtracted — they're an operating expense, not a revenue contra.
// For the processor-fee-inclusive view, see period_net_cash.

import { chargeEnriched, type StripeChargeLike, type StripeBalanceTransactionLike } from './chargeEnriched';
import { toMajor, type Period } from './types';

export interface StripeDisputeLike {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
}

export interface PeriodNetRevenueRow {
  currency: string;
  net_revenue: number;
  gross_collected: number;
  refunds: number;
  chargebacks: number;
  /** Net amount (gross − refunds) of charges excluded by exclude_fraud=true.
   *  0 when filter is off. */
  fraud_excluded: number;
}

export interface PeriodNetRevenueResult {
  kind: 'rows';
  rows: PeriodNetRevenueRow[];
  definition: 'javelin_defined.period_net_revenue';
  as_of: number;
  period: Period;
}

export interface PeriodNetRevenueInput {
  charges: StripeChargeLike[];
  balanceTransactions: StripeBalanceTransactionLike[];
  disputes: StripeDisputeLike[];
  period: Period;
  now: Date;
  /** When true, charges flagged fraudulent are excluded from gross_collected
   *  AND from refunds (i.e. removed from the calc entirely). Disputes filtered
   *  separately by reason='fraudulent' would double-count; here we leave the
   *  chargeback line independent because the user complaint surface is "the
   *  fraudulent transactions inflated my gross", and net_revenue's chargeback
   *  subtraction already represents realized fraud loss. M2 Phase 2A. */
  excludeFraud?: boolean;
}

// Dispute statuses that represent a realized loss to the merchant.
// Per def doc L310: 'lost', 'warning_closed'.
const LOST_DISPUTE_STATUSES = new Set(['lost', 'warning_closed']);

export function periodNetRevenue(input: PeriodNetRevenueInput): PeriodNetRevenueResult {
  const { charges, balanceTransactions, disputes, period, now, excludeFraud = false } = input;
  const enriched = chargeEnriched({ charges, balanceTransactions, now });

  type Bucket = {
    gross_collected: number;
    refunds: number;
    chargebacks: number;
    fraud_excluded: number;
  };
  const buckets = new Map<string, Bucket>();
  const getBucket = (currency: string): Bucket => {
    let b = buckets.get(currency);
    if (!b) {
      b = { gross_collected: 0, refunds: 0, chargebacks: 0, fraud_excluded: 0 };
      buckets.set(currency, b);
    }
    return b;
  };

  for (const row of enriched.rows) {
    if (row.status !== 'succeeded') continue;
    if (row.created_at < period.start || row.created_at > period.end) continue;
    const bucket = getBucket(row.currency);
    if (excludeFraud && row.is_fraudulent) {
      bucket.fraud_excluded += row.amount - row.amount_refunded;
      continue;
    }
    bucket.gross_collected += row.amount;
    bucket.refunds += row.amount_refunded;
  }

  for (const d of disputes) {
    if (!LOST_DISPUTE_STATUSES.has(d.status)) continue;
    if (d.created < period.start || d.created > period.end) continue;
    const bucket = getBucket(d.currency);
    bucket.chargebacks += toMajor(d.amount, d.currency);
  }

  const rows = Array.from(buckets.entries())
    .map(([currency, b]) => ({
      currency,
      net_revenue: b.gross_collected - b.refunds - b.chargebacks,
      gross_collected: b.gross_collected,
      refunds: b.refunds,
      chargebacks: b.chargebacks,
      fraud_excluded: b.fraud_excluded,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    kind: 'rows',
    rows,
    definition: 'javelin_defined.period_net_revenue',
    as_of: enriched.as_of,
    period,
  };
}
