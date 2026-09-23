// customer_rollup — one row per customer, denormalized with the fields needed for
// concentration, top-N, and segmentation questions.
// Spec: Build plan/metric-definitions.md L99–L124.
//
// M2.3 deviations from def doc (ratified 2026-04-22):
//   S2: single `current_mrr` scalar + new `mrr_currency` column (highest-MRR-currency wins
//       when a customer has subs in multiple currencies).
//   S3: replace scalar `active_plan` + `subscription_status` with a denormalized
//       `subscriptions` array (one entry per sub) — preserves multi-sub information for
//       concentration/top-N callers and V3 tool wrappers.
//   S1: `lifetime_collected` is honest about its inputs — it's the sum of net collected
//       across the charges passed in. V2 bundler passes an unbounded charges fetch when
//       planner routes to `customers`; V3 wrappers will window per-question.
//
// Inputs are joined client-side: customers + charge_enriched rows + subscription_enriched
// rows. We accept enriched rows (not raw Stripe objects) so the heavy lifting (currency
// conversion, MRR normalization) lives in the upstream metrics, and customer_rollup is
// purely a denormalizing join.

import type { ChargeEnrichedRow } from './chargeEnriched';
import type { SubscriptionEnrichedRow } from './subscriptionEnriched';

// ── Structural Stripe shape (minimal subset we read) ─────────────────────────

export interface StripeCustomerLike {
  id: string;
  name: string | null;
  email: string | null;
  created: number;
  deleted?: boolean;
}

// ── Output shape ──────────────────────────────────────────────────────────────

export interface CustomerRollupSubscription {
  plan_name: string;
  status: string;
  monthly_normalized_amount: number; // major units
  started_at: number;
}

export interface CustomerRollupRow {
  customer_id: string;
  name: string | null;
  email: string | null;
  card_country: string | null;        // from most-recent succeeded charge with non-null country
  created_at: number;                 // customer.created
  first_charge_at: number | null;     // earliest succeeded charge
  last_charge_at: number | null;      // latest succeeded charge
  lifetime_collected: number;         // major units; sum of net_collected across input succeeded charges
  lifetime_collected_currency: string | null; // dominant currency for lifetime_collected (or null)
  current_mrr: number;                // major units; sum across contributing subs in mrr_currency
  mrr_currency: string | null;        // currency picked by highest-MRR rule (M2.3-S2)
  subscriptions: CustomerRollupSubscription[]; // all subs for this customer (any state)
  subscription_count: number;         // subscriptions.length
}

export interface CustomerRollupResult {
  kind: 'rows';
  rows: CustomerRollupRow[];
  definition: 'javelin.customer_rollup.v1';
  as_of: number;
}

export interface CustomerRollupInput {
  customers: StripeCustomerLike[];
  charges: ChargeEnrichedRow[];           // enriched rows from chargeEnriched()
  subscriptions: SubscriptionEnrichedRow[]; // enriched rows from subscriptionEnriched()
  now: Date;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function customerRollup(input: CustomerRollupInput): CustomerRollupResult {
  const { customers, charges, subscriptions, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  // Index charges by customer_id (succeeded only — drives lifetime_collected,
  // first/last_charge_at, card_country).
  const succeededByCustomer = new Map<string, ChargeEnrichedRow[]>();
  for (const ch of charges) {
    if (ch.status !== 'succeeded') continue;
    if (ch.customer_id == null) continue;
    const list = succeededByCustomer.get(ch.customer_id) ?? [];
    list.push(ch);
    succeededByCustomer.set(ch.customer_id, list);
  }

  // Index subscriptions by customer_id.
  const subsByCustomer = new Map<string, SubscriptionEnrichedRow[]>();
  for (const sub of subscriptions) {
    const list = subsByCustomer.get(sub.customer_id) ?? [];
    list.push(sub);
    subsByCustomer.set(sub.customer_id, list);
  }

  const rows = customers
    .filter((c) => c.deleted !== true)
    .map((c): CustomerRollupRow => {
      const custCharges = succeededByCustomer.get(c.id) ?? [];
      const custSubs = subsByCustomer.get(c.id) ?? [];

      // ── Charge-derived fields ──────────────────────────────────────────────
      let first_charge_at: number | null = null;
      let last_charge_at: number | null = null;
      let card_country: string | null = null;
      let latestCardChargeAt = -Infinity;

      // Per-currency lifetime totals — used for both lifetime_collected (single
      // dominant currency wins) and to keep the metric honest about multi-currency
      // customers.
      const lifetimeByCurrency = new Map<string, number>();

      for (const ch of custCharges) {
        if (first_charge_at == null || ch.created_at < first_charge_at) {
          first_charge_at = ch.created_at;
        }
        if (last_charge_at == null || ch.created_at > last_charge_at) {
          last_charge_at = ch.created_at;
        }
        // card_country from the most-recent succeeded charge with a non-null country.
        if (ch.card_country != null && ch.created_at > latestCardChargeAt) {
          card_country = ch.card_country;
          latestCardChargeAt = ch.created_at;
        }
        const prev = lifetimeByCurrency.get(ch.currency) ?? 0;
        lifetimeByCurrency.set(ch.currency, prev + ch.net_collected);
      }

      // Pick lifetime_collected currency: largest total (matches M2.3-S2 highest-wins
      // pattern; concentration uses account-default currency separately).
      let lifetime_collected_currency: string | null = null;
      let lifetime_collected = 0;
      Array.from(lifetimeByCurrency.entries()).forEach(([currency, total]) => {
        if (total > lifetime_collected) {
          lifetime_collected = total;
          lifetime_collected_currency = currency;
        }
      });
      if (lifetimeByCurrency.size === 0) {
        lifetime_collected_currency = null;
        lifetime_collected = 0;
      }

      // ── Subscription-derived fields ────────────────────────────────────────
      const subscriptions: CustomerRollupSubscription[] = custSubs.map((s) => ({
        plan_name: s.plan_name,
        status: s.status,
        monthly_normalized_amount: s.monthly_normalized_amount,
        started_at: s.started_at,
      }));

      // current_mrr: sum monthly_normalized_amount per currency (only contributing subs),
      // pick highest-total currency (M2.3-S2).
      const mrrByCurrency = new Map<string, number>();
      for (const s of custSubs) {
        if (!s.contributes_to_mrr) continue;
        const prev = mrrByCurrency.get(s.currency) ?? 0;
        mrrByCurrency.set(s.currency, prev + s.monthly_normalized_amount);
      }
      let mrr_currency: string | null = null;
      let current_mrr = 0;
      Array.from(mrrByCurrency.entries()).forEach(([currency, total]) => {
        if (total > current_mrr) {
          current_mrr = total;
          mrr_currency = currency;
        }
      });
      if (mrrByCurrency.size === 0) {
        mrr_currency = null;
        current_mrr = 0;
      }

      return {
        customer_id: c.id,
        name: c.name,
        email: c.email,
        card_country,
        created_at: c.created,
        first_charge_at,
        last_charge_at,
        lifetime_collected,
        lifetime_collected_currency,
        current_mrr,
        mrr_currency,
        subscriptions,
        subscription_count: subscriptions.length,
      };
    });

  return {
    kind: 'rows',
    rows,
    definition: 'javelin.customer_rollup.v1',
    as_of: nowSec,
  };
}
