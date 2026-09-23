// customer_concentration — top-N customer share of period_collected_revenue.
// Spec: Build plan/metric-definitions.md L364–L385.
//
// M2.3 ratified decisions:
//   S4: Single-currency ranking. Caller passes `default_currency` (Stripe account's
//       default_currency); metric ranks customers within that currency only. Customers
//       whose succeeded charges in `period` are entirely in another currency contribute
//       $0 here. Documented limitation; revisit at first multi-currency merchant.
//
// Inputs: charge_enriched rows (already-converted to major units, customer-attributed)
// + period + default_currency. We filter charges to (status=succeeded, currency=default,
// created_at IN period, customer_id != null), aggregate per customer, rank top-10.

import type { ChargeEnrichedRow } from './chargeEnriched';
import type { CustomerRollupRow } from './customerRollup';
import type { Period } from './types';

// ── Output shape ──────────────────────────────────────────────────────────────

export interface CustomerConcentrationRow {
  rank: number;
  customer_id: string;
  name: string | null;
  email: string | null;
  /** name OR email OR "an unnamed customer" — pre-computed so the interpreter
   *  doesn't need to do fallback logic. Always non-empty. */
  display_name: string;
  amount: number;     // major units, in default_currency
  share: number;      // 0..1, fraction of period collected revenue in default_currency
}

export interface CustomerConcentrationValue {
  top_1_share: number;
  top_5_share: number;
  top_10_share: number;
  top_1_customer: {
    id: string;
    name: string | null;
    email: string | null;
    display_name: string;
    amount: number;
  } | null;
}

/** Pre-compute a presentable customer name. Many Stripe customers have null
 *  `name` (typical for direct-charge / Checkout flows where only email is
 *  collected). Falls through name → email → generic placeholder so the
 *  interpreter always has a non-empty string to use. */
function displayName(name: string | null, email: string | null): string {
  if (name && name.trim().length > 0) return name;
  if (email && email.trim().length > 0) return email;
  return 'an unnamed customer';
}

export interface CustomerConcentrationResult {
  kind: 'scalar';
  value: CustomerConcentrationValue;
  unit: 'percent';
  definition: 'javelin_defined.customer_concentration';
  rows: CustomerConcentrationRow[];     // top-10 (or fewer if customer count < 10)
  currency: string;                     // the default_currency used for ranking
  total_collected: number;              // denominator (major units, default_currency)
  period: Period;
  as_of: number;
}

export interface CustomerConcentrationInput {
  charges: ChargeEnrichedRow[];
  customers: CustomerRollupRow[];       // for name lookup
  period: Period;
  default_currency: string;             // Stripe account default_currency, lowercased
  now: Date;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function customerConcentration(
  input: CustomerConcentrationInput
): CustomerConcentrationResult {
  const { charges, customers, period, default_currency, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);
  const currency = default_currency.toLowerCase();

  // Name + email lookup from rollup rows. Email used as fallback for display_name
  // when the customer record has no name set in Stripe.
  const nameById = new Map<string, string | null>();
  const emailById = new Map<string, string | null>();
  for (const c of customers) {
    nameById.set(c.customer_id, c.name);
    emailById.set(c.customer_id, c.email);
  }

  // Aggregate per customer: succeeded charges in period, in default_currency, with customer.
  const totalsByCustomer = new Map<string, number>();
  let total_collected = 0;
  for (const ch of charges) {
    if (ch.status !== 'succeeded') continue;
    if (ch.currency !== currency) continue;
    if (ch.customer_id == null) continue;
    if (ch.created_at < period.start || ch.created_at > period.end) continue;
    const prev = totalsByCustomer.get(ch.customer_id) ?? 0;
    totalsByCustomer.set(ch.customer_id, prev + ch.net_collected);
    total_collected += ch.net_collected;
  }

  // Sort customers by amount desc.
  const ranked = Array.from(totalsByCustomer.entries())
    .map(([customer_id, amount]) => ({ customer_id, amount }))
    .sort((a, b) => b.amount - a.amount);

  const rows: CustomerConcentrationRow[] = ranked.slice(0, 10).map((r, i) => {
    const name = nameById.get(r.customer_id) ?? null;
    const email = emailById.get(r.customer_id) ?? null;
    return {
      rank: i + 1,
      customer_id: r.customer_id,
      name,
      email,
      display_name: displayName(name, email),
      amount: r.amount,
      share: total_collected > 0 ? r.amount / total_collected : 0,
    };
  });

  const sumTopN = (n: number): number =>
    ranked.slice(0, n).reduce((acc, r) => acc + r.amount, 0);

  const top_1_share = total_collected > 0 ? sumTopN(1) / total_collected : 0;
  const top_5_share = total_collected > 0 ? sumTopN(5) / total_collected : 0;
  const top_10_share = total_collected > 0 ? sumTopN(10) / total_collected : 0;

  const top_1_customer =
    ranked.length > 0
      ? (() => {
          const name = nameById.get(ranked[0].customer_id) ?? null;
          const email = emailById.get(ranked[0].customer_id) ?? null;
          return {
            id: ranked[0].customer_id,
            name,
            email,
            display_name: displayName(name, email),
            amount: ranked[0].amount,
          };
        })()
      : null;

  return {
    kind: 'scalar',
    value: { top_1_share, top_5_share, top_10_share, top_1_customer },
    unit: 'percent',
    definition: 'javelin_defined.customer_concentration',
    rows,
    currency,
    total_collected,
    period,
    as_of: nowSec,
  };
}
