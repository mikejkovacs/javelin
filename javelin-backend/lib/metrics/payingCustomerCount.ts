// paying_customer_count — count of distinct customers (plus guest payments)
// who paid in a date period. Strictly a flow metric — NOT customer-base state.
//
// Spec: Build plan/metric-definitions.md L280–L291.
//
// Definition tag: `javelin_defined.paying_customer_count`. No Stripe canonical
// "customers who paid in period" metric exists; closest reference is the
// Stripe Payments dashboard's customer view filtered by date.
//
// Source field: `charge.customer` from succeeded charges in the period.
// Charges with `customer: null` (guest checkouts, one-time payments without
// customer record) are surfaced separately as `guest_payments` and counted
// per-charge — there's no identity to dedupe on, so 3 guest checkouts from
// the same person show up as 3.
//
// Why charges (and not payment_intents): per the locked PCL decision
// (2026-04-30), Charges is the canonical read-path for completed payment
// data per Stripe's own migration guide.

import type { StripeChargeLike } from './chargeEnriched';
import { chargeEnriched } from './chargeEnriched';
import type { Period } from './types';

export interface PayingCustomerCountResult {
  kind: 'scalar';
  value: number;                                    // identified + guest (combined)
  unit: 'count';
  definition: 'javelin_defined.paying_customer_count';
  with_customer_record: number;                     // distinct customer IDs
  guest_payments: number;                           // charges with null customer
  charge_count: number;                             // total succeeded charges in period
  /** Charges excluded by exclude_fraud=true. 0 when filter is off. */
  fraud_excluded_charges: number;
  period: Period;
  as_of: number;
}

export interface PayingCustomerCountInput {
  charges: StripeChargeLike[];
  period: Period;
  now: Date;
  /** When true, charges flagged fraudulent (fraud_details.user_report or
   *  stripe_report = 'fraudulent') are excluded from all counts. M2 Phase 2A. */
  excludeFraud?: boolean;
}

function customerId(c: StripeChargeLike['customer']): string | null {
  if (c == null) return null;
  return typeof c === 'string' ? c : c.id;
}

function inPeriod(charge: StripeChargeLike, period: Period): boolean {
  return charge.created >= period.start && charge.created <= period.end;
}

export function payingCustomerCount(
  input: PayingCustomerCountInput,
): PayingCustomerCountResult {
  const { charges, period, now, excludeFraud = false } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  // Build a fraud-charge ID set when filter is on. chargeEnriched derives
  // is_fraudulent from fraud_details.user_report || stripe_report.
  let fraudChargeIds: Set<string> | null = null;
  if (excludeFraud) {
    const enriched = chargeEnriched({ charges, balanceTransactions: [], now });
    fraudChargeIds = new Set(
      enriched.rows.filter((r) => r.is_fraudulent).map((r) => r.charge_id),
    );
  }

  const distinctCustomers = new Set<string>();
  let guest_payments = 0;
  let charge_count = 0;
  let fraud_excluded_charges = 0;

  for (const charge of charges) {
    if (charge.status !== 'succeeded') continue;
    if (!inPeriod(charge, period)) continue;
    if (fraudChargeIds && fraudChargeIds.has(charge.id)) {
      fraud_excluded_charges += 1;
      continue;
    }
    charge_count += 1;
    const cid = customerId(charge.customer);
    if (cid == null) {
      guest_payments += 1;
    } else {
      distinctCustomers.add(cid);
    }
  }

  const with_customer_record = distinctCustomers.size;
  const value = with_customer_record + guest_payments;

  return {
    kind: 'scalar',
    value,
    unit: 'count',
    definition: 'javelin_defined.paying_customer_count',
    with_customer_record,
    guest_payments,
    charge_count,
    fraud_excluded_charges,
    period,
    as_of: nowSec,
  };
}
