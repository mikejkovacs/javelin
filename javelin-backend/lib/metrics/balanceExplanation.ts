// balance_explanation — Stripe's Balance Summary view of a time window.
//
// Definition tag: `stripe_canonical.balance_summary`. Mirrors Stripe's
// Dashboard Balance Summary report exactly:
//   Starting Balance → Activity (by reporting_category) → Payouts → Ending
// Activity buckets: `charge`, `refund`, `dispute`, `fee`, `adjustment`,
// `transfer`, `other`. Payouts surfaced separately (per Stripe canonical).
//
// Aggregation key: `reporting_category` (NOT `type`). The BalanceTransaction
// `type` field has 41 values; Stripe's Dashboard groups them via
// `reporting_category` into the ~6 buckets above. Categories outside our
// canonical set fall through to `'other'` defensively.
//
// Gross amounts per category + synthetic fees row (mirrors Stripe Dashboard):
// per-charge processing fees are inlined on the charge BalanceTransaction's
// `fee` field, not as separate `reporting_category='fee'` rows. To match
// Stripe's Balance Summary exactly we (a) use `amount` (gross) per category
// and (b) add a synthetic `fee` activity row summing `txn.fee` across ALL
// non-payout txns. Reconciles because `amount = net + fee`, so
//   sum(category amounts) + fee_row = sum(net) = net_activity.
//
// Multi-currency: per-currency block. CRITICAL RULE #8 (don't sum across
// currencies) enforced — each currency gets its own starting/activity/
// payouts/ending narrative arc.
//
// Starting balance derivation (Q-B / B2): callers pass
// `startingBalanceByCurrency` precomputed by the fetcher layer as
//   starting = current_balance − net_activity + payouts.total_outflow
// where current = `balance.available + balance.pending` from /v1/balance.
// This synthesis avoids a Stripe API that doesn't exist (BTs don't carry
// running balance; Stripe doesn't expose historical-balance lookup).

import type Stripe from 'stripe';
import type { Period } from './types';
import { toMajor } from './types';

export type ReportingCategory =
  | 'charge'
  | 'refund'
  | 'dispute'
  | 'fee'
  | 'adjustment'
  | 'transfer'
  | 'other';

const CANONICAL_CATEGORIES: ReadonlySet<string> = new Set<ReportingCategory>([
  'charge',
  'refund',
  'dispute',
  'fee',
  'adjustment',
  'transfer',
  'other',
]);

export interface ActivityRow {
  category: ReportingCategory;
  amount: number; // major units, signed (refunds/fees/disputes negative; charges positive)
  count: number;
}

export interface CurrencyBlock {
  currency: string;        // ISO 4217 lowercase
  starting_balance: number; // major units
  activity: ActivityRow[];   // payouts excluded; sorted by |amount| desc
  payouts: { count: number; total: number }; // total = absolute value of payout outflow, major units
  net_activity: number;    // sum of activity[].amount (payouts excluded), major units
  ending_balance: number;  // starting + net_activity − payouts.total
}

export interface BalanceExplanationInput {
  transactions: Stripe.BalanceTransaction[];
  startingBalanceByCurrency: Record<string, number>; // currency (lowercase) → starting balance major units
  period: Period;
  now: Date;
  truncated: boolean; // fetcher hit row cap
}

export interface BalanceExplanationResult {
  blocks: CurrencyBlock[];
  period: Period;
  truncated: boolean;
  definition: 'stripe_canonical.balance_summary';
  as_of: number;
}

function toCanonicalCategory(raw: string | null | undefined): ReportingCategory {
  if (raw && CANONICAL_CATEGORIES.has(raw)) {
    return raw as ReportingCategory;
  }
  // Stripe occasionally publishes new reporting_category values; map unknown
  // (including null) to 'other' so the caller never crashes on a category drift.
  return 'other';
}

export function balanceExplanation(
  input: BalanceExplanationInput,
): BalanceExplanationResult {
  const { transactions, startingBalanceByCurrency, period, now, truncated } = input;

  // Group: currency → category → {amount_minor (gross), count}.
  // Payouts tracked separately per Stripe canonical.
  // Per-row `fee` accumulated separately into a synthetic 'fee' activity row
  // (added at output-build time below).
  const byCurrency = new Map<
    string,
    {
      activity: Map<ReportingCategory, { amount_minor: number; count: number }>;
      fee_minor: number;        // sum of txn.fee across non-payout txns; non-negative
      fee_count: number;        // number of non-payout txns that incurred a fee
      payout_minor: number;     // negative; absolute value used in output
      payout_count: number;
    }
  >();

  for (const txn of transactions) {
    if (txn.created < period.start || txn.created > period.end) continue;
    const currency = txn.currency.toLowerCase();
    const block = byCurrency.get(currency) ?? {
      activity: new Map(),
      fee_minor: 0,
      fee_count: 0,
      payout_minor: 0,
      payout_count: 0,
    };
    const category = toCanonicalCategory(txn.reporting_category);
    if (txn.reporting_category === 'payout') {
      // Payouts: separate per Stripe canonical. Their fees (e.g. Instant
      // Payout fee) are excluded from the synthetic activity-fee row to
      // avoid double-counting against the dedicated payouts surface.
      block.payout_minor += txn.net;
      block.payout_count += 1;
    } else {
      // Activity bucket — gross amount per category; fee accumulated separately.
      const existing = block.activity.get(category) ?? {
        amount_minor: 0,
        count: 0,
      };
      existing.amount_minor += txn.amount;
      existing.count += 1;
      block.activity.set(category, existing);
      if (txn.fee && txn.fee > 0) {
        block.fee_minor += txn.fee;
        block.fee_count += 1;
      }
    }
    byCurrency.set(currency, block);
  }

  // Also surface currencies that have a starting balance but no in-period
  // activity — they're still part of the merchant's balance picture.
  for (const currency of Object.keys(startingBalanceByCurrency)) {
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, {
        activity: new Map(),
        fee_minor: 0,
        fee_count: 0,
        payout_minor: 0,
        payout_count: 0,
      });
    }
  }

  const blocks: CurrencyBlock[] = [];
  for (const [currency, raw] of byCurrency.entries()) {
    // Merge synthetic per-row fees into any existing standalone 'fee' bucket
    // before flattening, so the output has exactly ONE 'fee' row per currency.
    let net_activity_minor = 0;
    if (raw.fee_count > 0) {
      const existing = raw.activity.get('fee') ?? { amount_minor: 0, count: 0 };
      existing.amount_minor += -raw.fee_minor; // synthetic per-row fees are an outflow
      existing.count += raw.fee_count;
      raw.activity.set('fee', existing);
    }
    const activity: ActivityRow[] = [];
    for (const [cat, agg] of raw.activity.entries()) {
      activity.push({
        category: cat,
        amount: toMajor(agg.amount_minor, currency),
        count: agg.count,
      });
      net_activity_minor += agg.amount_minor;
    }
    // Sort activity by |amount| desc, then by category name asc for determinism.
    activity.sort((a, b) => {
      const ad = Math.abs(b.amount) - Math.abs(a.amount);
      if (ad !== 0) return ad;
      return a.category < b.category ? -1 : 1;
    });

    // payout net is negative (outflow); absolute-value for display.
    // Math.abs also normalizes the JS -0 / +0 corner case when payout_minor is 0.
    const payouts_outflow_minor = Math.abs(raw.payout_minor);
    const starting_balance = startingBalanceByCurrency[currency] ?? 0;
    const net_activity = toMajor(net_activity_minor, currency);
    const payouts_total = toMajor(payouts_outflow_minor, currency);
    const ending_balance = starting_balance + net_activity - payouts_total;

    blocks.push({
      currency,
      starting_balance,
      activity,
      payouts: { count: raw.payout_count, total: payouts_total },
      net_activity,
      ending_balance,
    });
  }

  // Sort blocks: dominant currency by absolute ending-balance magnitude desc,
  // then by currency name asc for determinism.
  blocks.sort((a, b) => {
    const m = Math.abs(b.ending_balance) - Math.abs(a.ending_balance);
    if (m !== 0) return m;
    return a.currency < b.currency ? -1 : 1;
  });

  return {
    blocks,
    period,
    truncated,
    definition: 'stripe_canonical.balance_summary',
    as_of: Math.floor(now.getTime() / 1000),
  };
}
