// growthAttribution — Phase 2E composition primitive.
//
// Decomposes MRR movement over a period into per-plan contributions,
// answering "where is growth coming from?" / "what plans are growing?".
//
// Composes on top of `computeMrrMovementEvents()` (uncapped). The cap on
// `mrr_movement`'s output events array is a presentational concern; for
// attribution we aggregate the full event set so totals reconcile to
// `totals_by_currency` exactly.
//
// Definition tag: `javelin_defined.growth_attribution`. No Stripe canonical
// "growth attribution" metric exists; this mirrors the industry pattern
// (ChartMogul / Baremetrics / ProfitWell decompose new MRR by plan).
//
// ── Scope (Phase 2E V1) ───────────────────────────────────────────────────────
// SUBSCRIPTION-BILLING SCOPE ONLY. Inherits `mrr_movement`'s data path:
//   Included: anything that flows through Stripe's Subscriptions API and
//     produces a subscription-linked invoice — recurring lines, plan changes,
//     add-ons, prorations, cancellations.
//   NOT included: one-off Stripe charges (Charges API / Payment Intents not
//     tied to an invoice), manually-created one-off invoices (Stripe Invoicing
//     API with no subscription link), or subscriptions managed outside Stripe
//     Billing. Merchants who run recurring billing outside Stripe's subscription
//     primitives will see those flows missing from growth attribution.
//   Surfaced via `scope: 'subscription_mrr'` envelope flag so the LLM can
//   clarify when narrating.
//
// ── Output shape ─────────────────────────────────────────────────────────────
//   - rows                 Per-(plan, currency) totals with per-bucket sums +
//                          net_contribution + pct_of_net_growth + event_count.
//                          Sorted by |net_contribution| desc. Top-20 retained;
//                          tail collapsed to one "Other (N plans)" row per
//                          currency, preserving arithmetic reconciliation.
//   - totals_by_currency   Per-currency rollup with bucket subtotals + net +
//                          plan_count (number of distinct plans contributing).
//   - truncated            true when an "Other" row is present.
//   - metric_type:'flow'   Same Q6 layer as mrr_movement (these are deltas).
//   - scope                Explicit scope flag (see above).
//   - coverage_starts_at   Forwarded from `computeMrrMovementEvents`.
//
// ── V1 limitations ───────────────────────────────────────────────────────────
// 1. Subscription-billing scope only (see above).
// 2. Plan attribution per-sub (inherits Q3=A from mrr_movement) — multi-line
//    subs with mixed plan changes attribute to the per-sub aggregated plan.
// 3. Plan-name precision depends on products fetch + dual-shape resolution;
//    unresolvable events land under plan_name 'unattributed'.
// 4. "Other (N plans)" rollup when >20 (plan, currency) rows — preserves
//    totals but loses individual plan identity for tail-21+ plans.
// 5. Inherits all mrr_movement F1 limitations (date precision, first-bill
//    latency, paused→resumed, trial→paid attribution, interval normalization).

import { computeMrrMovementEvents } from './mrrMovement';
import type { MrrMovementInput, MrrMovementBucket } from './mrrMovement';
import type { Period } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GrowthAttributionRow {
  plan_name: string;                  // resolved plan name; 'unattributed' or 'Other (N plans)'
  currency: string;
  new_mrr: number;                    // major units; +
  expansion_mrr: number;              // major units; +
  contraction_mrr: number;            // major units; -
  churned_mrr: number;                // major units; -
  net_contribution: number;           // sum of all four; the sort key
  /** Share of period net for this currency. Sign preserved from
   *  net_contribution / period_net (so a plan that DECLINED $700 on a $-1000
   *  period reads as 0.70; a plan that GREW $200 on a $-1000 period reads as
   *  -0.20, indicating it mitigated the decline). Null when period_net = 0. */
  pct_of_net_growth: number | null;
  event_count: number;
}

export interface GrowthAttributionResult {
  kind: 'rows';
  dimension: 'plan';                  // V1 fixed; param reserved for future country/cohort axes
  scope: 'subscription_mrr';          // see scope section in header
  rows: GrowthAttributionRow[];
  totals_by_currency: {
    [currency: string]: {
      new: number;
      expansion: number;
      contraction: number;            // stored as negative
      churned: number;                // stored as negative
      net: number;                    // sum of all four
      plan_count: number;             // distinct plans contributing in this currency
    };
  };
  truncated: boolean;
  metric_type: 'flow';
  coverage_starts_at: string | null;
  definition: 'javelin_defined.growth_attribution';
  period: Period;
  as_of: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PLAN_DETAIL_CAP = 20;

// ── Main ─────────────────────────────────────────────────────────────────────

export function growthAttribution(input: MrrMovementInput): GrowthAttributionResult {
  const { events, coverage_starts_at, as_of } = computeMrrMovementEvents(input);

  // Aggregate by (plan, currency)
  interface PlanAggregator {
    plan_name: string;
    currency: string;
    new: number;
    expansion: number;
    contraction: number;
    churned: number;
    event_count: number;
  }
  const planKeyed = new Map<string, PlanAggregator>();
  const perCurrency = new Map<
    string,
    {
      new: number;
      expansion: number;
      contraction: number;
      churned: number;
      plans: Set<string>;
    }
  >();

  for (const e of events) {
    const planKey = `${e.plan_name}|${e.currency}`;
    let agg = planKeyed.get(planKey);
    if (!agg) {
      agg = {
        plan_name: e.plan_name,
        currency: e.currency,
        new: 0,
        expansion: 0,
        contraction: 0,
        churned: 0,
        event_count: 0,
      };
      planKeyed.set(planKey, agg);
    }
    const bucket: MrrMovementBucket = e.bucket_type;
    agg[bucket] += e.amount;
    agg.event_count += 1;

    let cur = perCurrency.get(e.currency);
    if (!cur) {
      cur = {
        new: 0,
        expansion: 0,
        contraction: 0,
        churned: 0,
        plans: new Set(),
      };
      perCurrency.set(e.currency, cur);
    }
    cur[bucket] += e.amount;
    cur.plans.add(e.plan_name);
  }

  // Convert per-currency aggregator to totals_by_currency shape
  const totals_by_currency: GrowthAttributionResult['totals_by_currency'] = {};
  for (const [currency, sums] of perCurrency) {
    totals_by_currency[currency] = {
      new: sums.new,
      expansion: sums.expansion,
      contraction: sums.contraction,
      churned: sums.churned,
      net: sums.new + sums.expansion + sums.contraction + sums.churned,
      plan_count: sums.plans.size,
    };
  }

  // Build full rows with net_contribution; sort by |net_contribution| desc
  const allRows: GrowthAttributionRow[] = Array.from(planKeyed.values()).map(
    (agg) => {
      const net = agg.new + agg.expansion + agg.contraction + agg.churned;
      const periodNet = totals_by_currency[agg.currency]?.net ?? 0;
      const pct = periodNet === 0 ? null : net / periodNet;
      return {
        plan_name: agg.plan_name,
        currency: agg.currency,
        new_mrr: agg.new,
        expansion_mrr: agg.expansion,
        contraction_mrr: agg.contraction,
        churned_mrr: agg.churned,
        net_contribution: net,
        pct_of_net_growth: pct,
        event_count: agg.event_count,
      };
    },
  );
  allRows.sort((a, b) => Math.abs(b.net_contribution) - Math.abs(a.net_contribution));

  // Apply top-20 cap + per-currency "Other (N plans)" rollup
  let rows: GrowthAttributionRow[];
  let truncated = false;
  if (allRows.length > PLAN_DETAIL_CAP) {
    truncated = true;
    const topRows = allRows.slice(0, PLAN_DETAIL_CAP);
    const tailRows = allRows.slice(PLAN_DETAIL_CAP);
    // Group tail by currency, build one "Other" row per currency
    const tailByCurrency = new Map<
      string,
      {
        new: number;
        expansion: number;
        contraction: number;
        churned: number;
        event_count: number;
        plan_count: number;
      }
    >();
    for (const tail of tailRows) {
      let agg = tailByCurrency.get(tail.currency);
      if (!agg) {
        agg = {
          new: 0,
          expansion: 0,
          contraction: 0,
          churned: 0,
          event_count: 0,
          plan_count: 0,
        };
        tailByCurrency.set(tail.currency, agg);
      }
      agg.new += tail.new_mrr;
      agg.expansion += tail.expansion_mrr;
      agg.contraction += tail.contraction_mrr;
      agg.churned += tail.churned_mrr;
      agg.event_count += tail.event_count;
      agg.plan_count += 1;
    }
    const otherRows: GrowthAttributionRow[] = [];
    for (const [currency, agg] of tailByCurrency) {
      const net = agg.new + agg.expansion + agg.contraction + agg.churned;
      const periodNet = totals_by_currency[currency]?.net ?? 0;
      const pct = periodNet === 0 ? null : net / periodNet;
      otherRows.push({
        plan_name: `Other (${agg.plan_count} plans)`,
        currency,
        new_mrr: agg.new,
        expansion_mrr: agg.expansion,
        contraction_mrr: agg.contraction,
        churned_mrr: agg.churned,
        net_contribution: net,
        pct_of_net_growth: pct,
        event_count: agg.event_count,
      });
    }
    rows = [...topRows, ...otherRows];
  } else {
    rows = allRows;
  }

  return {
    kind: 'rows',
    dimension: 'plan',
    scope: 'subscription_mrr',
    rows,
    totals_by_currency,
    truncated,
    metric_type: 'flow',
    coverage_starts_at,
    definition: 'javelin_defined.growth_attribution',
    period: input.period,
    as_of,
  };
}
