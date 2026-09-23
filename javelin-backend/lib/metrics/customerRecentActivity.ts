// customer_recent_activity — chronological activity feed for a single
// customer. Composes data from charges, refunds, invoices, subscriptions,
// and disputes that no single Stripe endpoint returns together.
//
// Definition tag: `javelin_defined.customer_recent_activity`. Composition
// is Javelin-defined; underlying event sources are Stripe-canonical.
//
// Event types emitted (Q8.1 — full chronological feed):
//   - charge                    one per succeeded charge in window
//   - refund                    one synthetic event per refunded charge
//                               (Q-A: one event per refunded charge dated
//                               at charge.created — discrete refund-row
//                               events deferred until production validation
//                               surfaces the gap)
//   - invoice                   one per invoice finalized in window
//   - subscription_created      one per subscription created in window
//   - subscription_canceled     one per subscription ended in window
//   - dispute                   one per dispute created in window
//
// Pre-rendered `description` strings on each event let the LLM narrate
// without re-deriving formatting (matches Stripe Dashboard's customer-page
// language: "Paid CA$245.00", "Refunded CA$50.00", etc.).

import type Stripe from 'stripe';
import type { Period, TableMetadata } from './types';
import { toMajor } from './types';

export type ActivityEventType =
  | 'charge'
  | 'refund'
  | 'invoice'
  | 'subscription_created'
  | 'subscription_canceled'
  | 'subscription_item_change'
  | 'dispute';

/** Stripe Events API event filtered to customer.subscription.updated for the
 *  customer being looked up. The primitive consumes only the fields it needs;
 *  caller (fetcher) is responsible for filtering by customer. */
export interface SubscriptionUpdateEvent {
  /** Stripe event id (evt_*). */
  id: string;
  /** Event creation time, unix sec. */
  created: number;
  /** The post-update Subscription snapshot (from event.data.object). */
  subscription: {
    id: string;
    items?: {
      data: Array<{
        price?: {
          id: string;
          nickname?: string | null;
          product?: string | { name?: string | null } | null;
        } | null;
      }>;
    } | null;
  };
  /** Pre-update fields that changed (from event.data.previous_attributes).
   *  Phase 2A only inspects `items` to detect price/plan changes. */
  previous_attributes?: {
    items?: {
      data?: Array<{
        price?: { id?: string | null } | null;
      }>;
    } | null;
  } | null;
}

/** Heads-up entry for an active subscription that is set to cancel at period
 *  end. Surfaced separately from the chronological event timeline because
 *  scheduled cancellation is forward-looking state, not a past occurrence. */
export interface UpcomingCancellation {
  subscription_id: string;
  /** Best-effort plan label resolved from items[].price.nickname or
   *  product.name; null when neither is available. */
  plan_name: string | null;
  /** Future cancellation date (Stripe sub.cancel_at). */
  cancels_at: number;
  cancels_at_iso: string;
}

export interface ActivityEvent {
  type: ActivityEventType;
  occurred_at: number;            // unix seconds; drives chronological sort
  occurred_at_iso: string;        // 'YYYY-MM-DD' UTC, for table rendering + narration
  amount: number | null;          // major units; null for non-monetary events
  currency: string | null;        // ISO 4217 lowercase; null for non-monetary events
  /** Pre-rendered cell value for the activity table; LLM can also use this
   *  in narration verbatim. Capitalized verb-first ("Paid", "Refunded",
   *  "Invoice finalized", "Subscription canceled", "Dispute opened"). */
  description: string;
  status: string | null;          // 'succeeded', 'failed', 'paid', 'open', 'canceled', etc.
  /** Internal — Stripe object id (ch_*, in_*, sub_*, dp_*). NOT surfaced
   *  in narration; available for debugging only. */
  source_id: string;
}

export interface CustomerRecentActivityResult {
  kind: 'rows';
  customer_id: string;
  customer_display_name: string;
  rows: ActivityEvent[];          // sorted desc by occurred_at
  period: Period;
  event_count_by_type: Partial<Record<ActivityEventType, number>>;
  /** True when the fetcher hit a row cap and the activity feed may be
   *  incomplete. Defensive surface (Q-C) — operator narration should
   *  hedge ("Showing the most recent N events; older activity is cut off"). */
  truncated: boolean;
  /** Stripe Events API has a 30-day retention window; older subscription
   *  plan-change history can't be reconstructed without Sigma. The LLM uses
   *  this number to hedge narration ("showing plan changes in the last 30
   *  days; older changes aren't available"). M2 Phase 2A. */
  subscription_history_window_days: number;
  /** Forward-looking heads-up: any of the customer's active subscriptions
   *  that are scheduled to cancel at period end. Empty when none. */
  upcoming_cancellations: UpcomingCancellation[];
  table: TableMetadata;
  definition: 'javelin_defined.customer_recent_activity';
  as_of: number;
}

export interface CustomerRecentActivityInput {
  customer: Stripe.Customer;
  charges: Stripe.Charge[];           // already filtered to this customer
  invoices: Stripe.Invoice[];
  subscriptions: Stripe.Subscription[];
  disputes: Stripe.Dispute[];
  /** Stripe Events API events of type customer.subscription.updated for this
   *  customer's subscriptions, within the period window. Optional — when
   *  omitted/empty, no plan-change events are emitted. M2 Phase 2A. */
  subscriptionUpdateEvents?: SubscriptionUpdateEvent[];
  period: Period;
  now: Date;
  truncated: boolean;
}

/** Stripe Events API retention. Documented at
 *  https://stripe.com/docs/api/events as roughly 30 days for most accounts. */
export const SUBSCRIPTION_HISTORY_WINDOW_DAYS = 30;

const RECENT_ACTIVITY_TABLE: TableMetadata = {
  columns: [
    { field: 'occurred_at_iso', label: 'Date', align: 'left', format: 'date' },
    { field: 'description', label: 'Activity', align: 'left' },
    {
      field: 'amount',
      label: 'Amount',
      align: 'right',
      format: 'currency',
      currency_field: 'currency',
    },
    { field: 'status', label: 'Status', align: 'left' },
  ],
  sort_default: { field: 'occurred_at', order: 'desc' },
  empty_label: 'No activity in this period',
};

function isoDateUTC(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function deriveDisplayName(customer: Stripe.Customer): string {
  if (customer.name && customer.name.trim().length > 0) return customer.name;
  if (customer.email && customer.email.trim().length > 0) return customer.email;
  return 'an unnamed customer';
}

function formatAmount(amount_major: number, currency: string): string {
  // Plain "$X.XX CCY" — frontend table cell will reformat per Stripe Dashboard
  // currency convention; the description string is fallback / narration use.
  const fixed = amount_major.toFixed(2);
  return `${currency.toUpperCase()} ${fixed}`;
}

function inPeriod(unixSec: number | null | undefined, period: Period): boolean {
  if (unixSec == null) return false;
  return unixSec >= period.start && unixSec <= period.end;
}

/** Resolve a human-readable plan label from a subscription's items array.
 *  Falls back through nickname → product.name → null. */
function resolvePlanName(sub: Stripe.Subscription): string | null {
  const items = sub.items?.data;
  if (!items || items.length === 0) return null;
  const price = items[0]?.price;
  if (!price) return null;
  if (price.nickname && price.nickname.trim().length > 0) return price.nickname;
  const product = price.product;
  if (product && typeof product !== 'string' && 'name' in product && product.name) {
    return product.name;
  }
  return null;
}

/** Resolve a plan label from an event-payload subscription snapshot. */
function resolveEventPlanName(
  sub: SubscriptionUpdateEvent['subscription'],
): string | null {
  const items = sub.items?.data;
  if (!items || items.length === 0) return null;
  const price = items[0]?.price;
  if (!price) return null;
  if (price.nickname && price.nickname.trim().length > 0) return price.nickname;
  const product = price.product;
  if (product && typeof product !== 'string' && product.name) {
    return product.name;
  }
  return null;
}

/** Detect a plan/price change from event.previous_attributes vs current items. */
function priceIdsChanged(event: SubscriptionUpdateEvent): boolean {
  const prevItems = event.previous_attributes?.items?.data;
  if (!prevItems || prevItems.length === 0) return false;
  const currentPriceIds = new Set(
    (event.subscription.items?.data ?? [])
      .map((it) => it.price?.id)
      .filter((id): id is string => typeof id === 'string'),
  );
  for (const prev of prevItems) {
    const prevId = prev.price?.id;
    if (prevId && !currentPriceIds.has(prevId)) return true;
  }
  return false;
}

export function customerRecentActivity(
  input: CustomerRecentActivityInput,
): CustomerRecentActivityResult {
  const {
    customer,
    charges,
    invoices,
    subscriptions,
    disputes,
    subscriptionUpdateEvents = [],
    period,
    now,
    truncated,
  } = input;

  const events: ActivityEvent[] = [];

  // Charges + synthetic refund events
  for (const charge of charges) {
    if (!inPeriod(charge.created, period)) continue;
    if (charge.status !== 'succeeded' && charge.status !== 'failed') continue;
    const amount_major = toMajor(charge.amount, charge.currency);
    const description =
      charge.status === 'succeeded'
        ? `Paid ${formatAmount(amount_major, charge.currency)}`
        : `Failed payment of ${formatAmount(amount_major, charge.currency)}`;
    events.push({
      type: 'charge',
      occurred_at: charge.created,
      occurred_at_iso: isoDateUTC(charge.created),
      amount: amount_major,
      currency: charge.currency.toLowerCase(),
      description,
      status: charge.status,
      source_id: charge.id,
    });
    // Q-A: one synthetic refund event per refunded charge, dated at charge.created.
    // Discrete per-refund-row events deferred.
    if (charge.amount_refunded > 0) {
      const refund_major = toMajor(charge.amount_refunded, charge.currency);
      events.push({
        type: 'refund',
        occurred_at: charge.created,
        occurred_at_iso: isoDateUTC(charge.created),
        amount: -refund_major,
        currency: charge.currency.toLowerCase(),
        description: `Refunded ${formatAmount(refund_major, charge.currency)}`,
        status: charge.refunded ? 'fully_refunded' : 'partially_refunded',
        source_id: charge.id,
      });
    }
  }

  // Invoices — finalized_at within window (matches period_billed_revenue's
  // canonical date per metric-definitions.md). Skip drafts.
  for (const invoice of invoices) {
    const finalized_at = invoice.status_transitions?.finalized_at;
    if (!inPeriod(finalized_at, period)) continue;
    if (invoice.status === 'draft') continue;
    const amount_major = toMajor(invoice.total, invoice.currency);
    events.push({
      type: 'invoice',
      occurred_at: finalized_at!,
      occurred_at_iso: isoDateUTC(finalized_at!),
      amount: amount_major,
      currency: invoice.currency.toLowerCase(),
      description: `Invoice ${invoice.status} (${formatAmount(amount_major, invoice.currency)})`,
      status: invoice.status ?? null,
      source_id: invoice.id ?? '',
    });
  }

  // Subscription created + canceled events
  for (const sub of subscriptions) {
    if (inPeriod(sub.created, period)) {
      events.push({
        type: 'subscription_created',
        occurred_at: sub.created,
        occurred_at_iso: isoDateUTC(sub.created),
        amount: null,
        currency: null,
        description: `Subscription created`,
        status: sub.status,
        source_id: sub.id,
      });
    }
    if (sub.ended_at != null && inPeriod(sub.ended_at, period)) {
      events.push({
        type: 'subscription_canceled',
        occurred_at: sub.ended_at,
        occurred_at_iso: isoDateUTC(sub.ended_at),
        amount: null,
        currency: null,
        description: `Subscription canceled`,
        status: sub.status,
        source_id: sub.id,
      });
    }
  }

  // Subscription plan/price changes (M2 Phase 2A). One event per
  // customer.subscription.updated event whose items array changed price IDs.
  // Description resolves the new plan name from the post-update payload;
  // falls back to a neutral string when the name can't be derived.
  for (const event of subscriptionUpdateEvents) {
    if (!inPeriod(event.created, period)) continue;
    if (!priceIdsChanged(event)) continue;
    const newPlanName = resolveEventPlanName(event.subscription);
    const description = newPlanName
      ? `Plan changed to ${newPlanName}`
      : 'Subscription plan changed';
    events.push({
      type: 'subscription_item_change',
      occurred_at: event.created,
      occurred_at_iso: isoDateUTC(event.created),
      amount: null,
      currency: null,
      description,
      status: null,
      source_id: event.subscription.id,
    });
  }

  // Disputes — joined to charges client-side; only emit dispute events when
  // the dispute's underlying charge belongs to this customer.
  const customerChargeIds = new Set(charges.map((c) => c.id));
  for (const dispute of disputes) {
    if (!inPeriod(dispute.created, period)) continue;
    const chargeId =
      typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
    if (!chargeId || !customerChargeIds.has(chargeId)) continue;
    const amount_major = toMajor(dispute.amount, dispute.currency);
    events.push({
      type: 'dispute',
      occurred_at: dispute.created,
      occurred_at_iso: isoDateUTC(dispute.created),
      amount: -amount_major,
      currency: dispute.currency.toLowerCase(),
      description: `Dispute ${dispute.status} (${formatAmount(amount_major, dispute.currency)})`,
      status: dispute.status ?? null,
      source_id: dispute.id ?? '',
    });
  }

  // Sort: desc by occurred_at, then by type for deterministic ordering when
  // multiple events share a timestamp (charge + its synthetic refund event).
  events.sort((a, b) => {
    if (a.occurred_at !== b.occurred_at) return b.occurred_at - a.occurred_at;
    return a.type < b.type ? -1 : 1;
  });

  // Roll up event counts by type for the result envelope.
  const event_count_by_type: Partial<Record<ActivityEventType, number>> = {};
  for (const event of events) {
    event_count_by_type[event.type] =
      (event_count_by_type[event.type] ?? 0) + 1;
  }

  // Forward-looking heads-up — active subs scheduled to cancel at period end.
  // Source: sub.cancel_at_period_end + sub.cancel_at on the already-fetched
  // customer subscriptions (no extra fetch). M2 Phase 2A.
  const upcoming_cancellations: UpcomingCancellation[] = [];
  for (const sub of subscriptions) {
    if (!sub.cancel_at_period_end) continue;
    if (sub.cancel_at == null) continue;
    if (sub.status !== 'active' && sub.status !== 'past_due' && sub.status !== 'trialing') {
      continue;
    }
    upcoming_cancellations.push({
      subscription_id: sub.id,
      plan_name: resolvePlanName(sub),
      cancels_at: sub.cancel_at,
      cancels_at_iso: isoDateUTC(sub.cancel_at),
    });
  }

  return {
    kind: 'rows',
    customer_id: customer.id,
    customer_display_name: deriveDisplayName(customer),
    rows: events,
    period,
    event_count_by_type,
    truncated,
    subscription_history_window_days: SUBSCRIPTION_HISTORY_WINDOW_DAYS,
    upcoming_cancellations,
    table: RECENT_ACTIVITY_TABLE,
    definition: 'javelin_defined.customer_recent_activity',
    as_of: Math.floor(now.getTime() / 1000),
  };
}
