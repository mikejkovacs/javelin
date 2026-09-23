// subscription_enriched — one row per subscription with normalized MRR-relevant fields.
// Spec: Build plan/metric-definitions.md L126–L158.
//
// Input: Stripe Subscription list (active + past_due). The metric trusts caller-supplied
// shape; Stripe SDK types are structurally compatible with the interfaces below.

import { toMajor } from './types';

// ── Structural Stripe shape (minimal subset we read) ─────────────────────────

export interface StripeDiscountLike {
  coupon: {
    percent_off: number | null;
    amount_off: number | null;
    currency: string | null;
    duration: 'once' | 'repeating' | 'forever';
  };
}

export interface StripeSubscriptionItemLike {
  id: string;
  quantity: number | null;
  price: {
    id: string;
    nickname: string | null;
    unit_amount: number | null;
    currency: string;
    product: string | { id: string; name?: string | null };
    recurring: {
      interval: 'day' | 'week' | 'month' | 'year';
      interval_count: number;
      usage_type: 'licensed' | 'metered';
    } | null;
  };
  discounts?: StripeDiscountLike[] | null;
}

export interface StripeSubscriptionLike {
  id: string;
  customer: string | { id: string };
  status: string;
  start_date: number;
  canceled_at: number | null;
  ended_at: number | null;
  cancellation_details?: {
    reason: string | null;
    feedback?: string | null;
  } | null;
  pause_collection?: {
    behavior: 'keep_as_draft' | 'mark_uncollectible' | 'void';
  } | null;
  trial_end: number | null;
  discounts?: StripeDiscountLike[] | null;
  items: { data: StripeSubscriptionItemLike[] };
}

// ── Output shape (per def doc L132–L152) ──────────────────────────────────────

export interface SubscriptionEnrichedRow {
  subscription_id: string;
  customer_id: string;
  status: string;
  monthly_normalized_amount: number;
  raw_amount: number;
  currency: string;
  interval: 'day' | 'week' | 'month' | 'year';
  interval_count: number;
  plan_name: string;
  product_id: string;
  price_id: string;
  started_at: number;
  canceled_at: number | null;
  ended_at: number | null;
  cancellation_reason: string | null;
  pause_collection_behavior: 'void' | 'mark_uncollectible' | 'keep_as_draft' | null;
  contributes_to_mrr: boolean;
}

export interface SubscriptionEnrichedResult {
  kind: 'rows';
  rows: SubscriptionEnrichedRow[];
  definition: 'javelin.subscription_enriched.v1';
  as_of: number;
}

export interface SubscriptionEnrichedInput {
  subscriptions: StripeSubscriptionLike[];
  now: Date;
}

// ── Internals ────────────────────────────────────────────────────────────────

// interval → monthly multiplier, per def doc L156.
const INTERVAL_TO_MONTHLY: Record<'day' | 'week' | 'month' | 'year', number> = {
  day: 365 / 12,
  week: 52 / 12,
  month: 1,
  year: 1 / 12,
};

function customerId(c: StripeSubscriptionLike['customer']): string {
  return typeof c === 'string' ? c : c.id;
}

function productInfo(
  p: StripeSubscriptionItemLike['price']['product']
): { id: string; name: string | null } {
  if (typeof p === 'string') return { id: p, name: null };
  return { id: p.id, name: p.name ?? null };
}

// Excludes the whole subscription from MRR contribution.
function isSubMrrExcluded(sub: StripeSubscriptionLike, nowSec: number): boolean {
  if (sub.status !== 'active' && sub.status !== 'past_due') return true;
  if (sub.trial_end != null && sub.trial_end > nowSec) return true;
  const pause = sub.pause_collection?.behavior;
  if (pause === 'void' || pause === 'mark_uncollectible') return true;
  return false;
}

// Excludes an individual item from the MRR sum (item stays in the sub, contributes 0).
function isItemExcluded(item: StripeSubscriptionItemLike): boolean {
  if (!item.price.recurring) return true;
  if (item.price.recurring.usage_type === 'metered') return true;
  if (item.price.unit_amount == null || item.price.unit_amount === 0) return true;
  return false;
}

function applyDiscountMajor(
  amountMajor: number,
  discount: StripeDiscountLike,
  currency: string
): number {
  const c = discount.coupon;
  if (c.percent_off != null) return amountMajor * (1 - c.percent_off / 100);
  if (c.amount_off != null) {
    // Assume coupon currency matches sub currency (Stripe enforces this at coupon-creation time
    // via its currency field; mixed-currency discounts on a sub are rare). If coupon.currency
    // is set and mismatches, we still subtract — documented caveat; revisit if validation flags.
    const offMajor = toMajor(c.amount_off, c.currency ?? currency);
    return Math.max(0, amountMajor - offMajor);
  }
  return amountMajor;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function subscriptionEnriched(
  input: SubscriptionEnrichedInput
): SubscriptionEnrichedResult {
  const { subscriptions, now } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  const rows = subscriptions.map((sub): SubscriptionEnrichedRow => {
    const subExcluded = isSubMrrExcluded(sub, nowSec);
    const items = sub.items.data;
    // Stripe enforces single-currency single-interval across items on one sub.
    // Take those from the first item.
    const firstItem = items[0];
    const currency = firstItem.price.currency;
    const interval = firstItem.price.recurring?.interval ?? 'month';
    const interval_count = firstItem.price.recurring?.interval_count ?? 1;

    // Sum paid, non-metered items in minor units.
    let raw_minor = 0;
    for (const item of items) {
      if (isItemExcluded(item)) continue;
      let itemMinor = (item.price.unit_amount ?? 0) * (item.quantity ?? 1);
      // Apply item-level discounts in minor units (percent is unit-agnostic; amount_off
      // is in the coupon's currency, assumed same as item for now).
      if (item.discounts) {
        for (const d of item.discounts) {
          if (d.coupon.percent_off != null) {
            itemMinor = itemMinor * (1 - d.coupon.percent_off / 100);
          } else if (d.coupon.amount_off != null) {
            itemMinor = Math.max(0, itemMinor - d.coupon.amount_off);
          }
        }
      }
      raw_minor += itemMinor;
    }

    // Convert to major units, then apply subscription-level discounts.
    let raw_amount = toMajor(raw_minor, currency);
    if (sub.discounts) {
      for (const d of sub.discounts) {
        raw_amount = applyDiscountMajor(raw_amount, d, currency);
      }
    }

    const monthly_normalized_amount = subExcluded
      ? 0
      : (raw_amount / interval_count) * INTERVAL_TO_MONTHLY[interval];

    const product = productInfo(firstItem.price.product);
    const plan_name = firstItem.price.nickname ?? product.name ?? '';

    return {
      subscription_id: sub.id,
      customer_id: customerId(sub.customer),
      status: sub.status,
      monthly_normalized_amount,
      raw_amount,
      currency,
      interval,
      interval_count,
      plan_name,
      product_id: product.id,
      price_id: firstItem.price.id,
      started_at: sub.start_date,
      canceled_at: sub.canceled_at,
      ended_at: sub.ended_at,
      cancellation_reason: sub.cancellation_details?.reason ?? null,
      pause_collection_behavior: sub.pause_collection?.behavior ?? null,
      contributes_to_mrr: !subExcluded && raw_amount > 0,
    };
  });

  return {
    kind: 'rows',
    rows,
    definition: 'javelin.subscription_enriched.v1',
    as_of: nowSec,
  };
}
