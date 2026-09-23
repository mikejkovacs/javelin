// arpu — average revenue per paying customer.
//
// Two bases (M2 Phase 2A — locked 2026-05-07):
//   - 'recurring'  → MRR ÷ active_subscription_count   (run-rate, no period)
//   - 'collected'  → period_collected_revenue ÷ paying_customer_count  (period flow)
//
// They measure different things and answer different questions; for hybrid
// merchants the LLM is taught (via tool description + few-shot) to call both
// in sequence and present each lens distinctly. Mirrors CRITICAL RULE #9's
// two-stream pattern for revenue.
//
// Definition tag: javelin_defined.arpu — no Stripe-canonical primitive named
// ARPU exists; the closest reference is the Stripe Billing analytics ARPU
// (recurring-basis only). Collected basis extends for non-subs / hybrid
// merchants who don't have meaningful run-rate ARPU.

import { mrr } from './mrr';
import type { StripeSubscriptionLike } from './subscriptionEnriched';
import { activeSubscriptionCount } from './activeSubscriptionCount';
import { periodCollectedRevenue } from './periodCollectedRevenue';
import { payingCustomerCount } from './payingCustomerCount';
import type { StripeChargeLike, StripeBalanceTransactionLike } from './chargeEnriched';
import type { Period } from './types';

export type ArpuBasis = 'recurring' | 'collected';

export interface ArpuRow {
  currency: string;
  arpu: number;
  /** The numerator: MRR for recurring, collected_revenue for collected. */
  source_revenue: number;
  /** The denominator: active_subscription_count for recurring (uniform across
   *  currencies — sub count isn't currency-bucketed), paying_customer_count
   *  for collected. */
  customer_count: number;
  basis: ArpuBasis;
  /** True when customer_count < 10. Voice signal — small samples are noisy. */
  low_sample: boolean;
}

export interface ArpuResult {
  kind: 'rows';
  rows: ArpuRow[];
  basis: ArpuBasis;
  definition: 'javelin_defined.arpu';
  as_of: number;
  /** Echoed back for collected basis; null for recurring. */
  period: Period | null;
}

export type ArpuInput =
  | {
      basis: 'recurring';
      subscriptions: StripeSubscriptionLike[];
      now: Date;
    }
  | {
      basis: 'collected';
      charges: StripeChargeLike[];
      balanceTransactions: StripeBalanceTransactionLike[];
      period: Period;
      now: Date;
    };

const LOW_SAMPLE_THRESHOLD = 10;

export function arpu(input: ArpuInput): ArpuResult {
  const nowSec = Math.floor(input.now.getTime() / 1000);

  if (input.basis === 'recurring') {
    const mrrResult = mrr({ subscriptions: input.subscriptions, now: input.now });
    const subCount = activeSubscriptionCount({
      subscriptions: input.subscriptions,
      now: input.now,
    }).value;

    // Recurring ARPU divides per-currency MRR by the global active sub count.
    // Subscription count is not currency-bucketed; the same denominator is
    // used across rows. Edge: zero subs → 0/0 reported as 0 with low_sample.
    const rows: ArpuRow[] = mrrResult.rows.map((row) => ({
      currency: row.currency,
      arpu: subCount === 0 ? 0 : row.mrr / subCount,
      source_revenue: row.mrr,
      customer_count: subCount,
      basis: 'recurring' as const,
      low_sample: subCount < LOW_SAMPLE_THRESHOLD,
    }));

    // When there are no MRR-bucketed currencies (no active subs at all),
    // still emit a single row so the LLM can narrate the empty state.
    if (rows.length === 0) {
      rows.push({
        currency: 'unknown',
        arpu: 0,
        source_revenue: 0,
        customer_count: subCount,
        basis: 'recurring',
        low_sample: true,
      });
    }

    return {
      kind: 'rows',
      rows,
      basis: 'recurring',
      definition: 'javelin_defined.arpu',
      as_of: nowSec,
      period: null,
    };
  }

  // basis === 'collected'
  const collected = periodCollectedRevenue({
    charges: input.charges,
    balanceTransactions: input.balanceTransactions,
    period: input.period,
    now: input.now,
  });
  const payCount = payingCustomerCount({
    charges: input.charges,
    period: input.period,
    now: input.now,
  }).value;

  const rows: ArpuRow[] = collected.rows.map((row) => ({
    currency: row.currency,
    arpu: payCount === 0 ? 0 : row.collected_revenue / payCount,
    source_revenue: row.collected_revenue,
    customer_count: payCount,
    basis: 'collected' as const,
    low_sample: payCount < LOW_SAMPLE_THRESHOLD,
  }));

  if (rows.length === 0) {
    rows.push({
      currency: 'unknown',
      arpu: 0,
      source_revenue: 0,
      customer_count: payCount,
      basis: 'collected',
      low_sample: true,
    });
  }

  return {
    kind: 'rows',
    rows,
    basis: 'collected',
    definition: 'javelin_defined.arpu',
    as_of: nowSec,
    period: input.period,
  };
}
