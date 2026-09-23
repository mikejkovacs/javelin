// largest_charges_in_period — top-N individual charges by net collected
// amount in a date period. Self-defined (`javelin_defined.largest_charges_in_period`)
// — no Stripe-canonical equivalent. Ranks by net_collected (gross minus
// refunds) so a fully-refunded charge naturally falls off the top-N.
//
// Mirrors customerConcentration's input shape (chargeEnriched + customerRollup
// for name lookup) so we share the upstream pipeline in the tool wrapper.

import type { ChargeEnrichedRow } from './chargeEnriched';
import type { CustomerRollupRow } from './customerRollup';
import type { Period } from './types';

// ── Output shape ──────────────────────────────────────────────────────────────

export interface LargestChargeRow {
  rank: number;
  charge_id: string;
  amount: number;              // major units, net_collected (post-refund)
  currency: string;
  customer_id: string | null;
  customer_display_name: string;  // 'an unnamed customer' if no customer_id
  occurred_at_iso: string;     // pre-rendered to dodge unix→ISO LLM mistakes
  refunded: boolean;
  disputed: boolean;
}

export interface LargestChargesResult {
  kind: 'rows';
  rows: LargestChargeRow[];
  definition: 'javelin_defined.largest_charges_in_period';
  currency: string;            // the default_currency used for ranking
  period: Period;
  as_of: number;
}

export interface LargestChargesInput {
  charges: ChargeEnrichedRow[];
  customers: CustomerRollupRow[];
  period: Period;
  default_currency: string;
  n: number;                   // top-N (1..10)
  now: Date;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function displayName(name: string | null, email: string | null): string {
  if (name && name.trim().length > 0) return name;
  if (email && email.trim().length > 0) return email;
  return 'an unnamed customer';
}

function isoFromUnix(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function largestCharges(input: LargestChargesInput): LargestChargesResult {
  const { charges, customers, period, default_currency, n, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);
  const currency = default_currency.toLowerCase();

  const nameById = new Map<string, string | null>();
  const emailById = new Map<string, string | null>();
  for (const c of customers) {
    nameById.set(c.customer_id, c.name);
    emailById.set(c.customer_id, c.email);
  }

  // Filter: succeeded, default currency, in period.
  const eligible = charges.filter(
    (ch) =>
      ch.status === 'succeeded' &&
      ch.currency === currency &&
      ch.created_at >= period.start &&
      ch.created_at <= period.end,
  );

  // Sort by net_collected desc; tie-break on created_at desc (more recent
  // wins) so output is deterministic when amounts match.
  const ranked = [...eligible].sort((a, b) => {
    if (b.net_collected !== a.net_collected) {
      return b.net_collected - a.net_collected;
    }
    return b.created_at - a.created_at;
  });

  const rows: LargestChargeRow[] = ranked.slice(0, n).map((ch, i) => {
    const name = ch.customer_id ? (nameById.get(ch.customer_id) ?? null) : null;
    const email = ch.customer_id
      ? (emailById.get(ch.customer_id) ?? null)
      : null;
    return {
      rank: i + 1,
      charge_id: ch.charge_id,
      amount: ch.net_collected,
      currency: ch.currency,
      customer_id: ch.customer_id,
      customer_display_name: displayName(name, email),
      occurred_at_iso: isoFromUnix(ch.created_at),
      refunded: ch.refunded,
      disputed: ch.disputed,
    };
  });

  return {
    kind: 'rows',
    rows,
    definition: 'javelin_defined.largest_charges_in_period',
    currency,
    period,
    as_of: nowSec,
  };
}
