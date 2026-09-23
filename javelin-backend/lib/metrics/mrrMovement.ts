// mrrMovement — invoice-derived MRR Movement decomposition by bucket type.
//
// Phase 2D (Option F1 + Option B, locked 2026-05-13). Sibling to `mrr`
// (STATE — current run-rate snapshot); this primitive answers FLOW
// questions ("how did MRR change?") without depending on Stripe Sigma.
// Uses invoice history (multi-year retention on Stripe) + subscription
// state to derive per-bucket movement events.
//
// Bucket definitions (Q1=A — 4 buckets, reactivation collapses into new):
//   - new          subscription.created IN period → first invoice's MRR
//   - expansion    consecutive invoices show amount increase → delta
//   - contraction  consecutive invoices show amount decrease → delta
//   - churned      subscription.ended_at IN period → last invoice's MRR (sign flipped)
//
// Output shape (Option B):
//   - rows                Per-(bucket, currency) totals
//   - events              Per-event detail (top-50 by |amount| desc; truncated flag)
//   - totals_by_currency  Per-currency rollup with bucket + net subtotals
//   - metric_type:'flow'  Q6 Layer 2 — lexical guard against state/flow confusion
//   - coverage_starts_at  Earliest invoice date observed in period (LLM hedging signal)
//
// Q5=A multi-currency: per-(bucket, currency) tuples; no FX; CRITICAL RULE #8.
// Q3=A per-sub: each subscription's invoice history is independent.
//
// ── DOCUMENTED V1 LIMITATIONS (future F2 layer addresses 1 + 2) ──────────────
// 1. Date precision is invoice-date, not change-date. Movement events are
//    attributed to the invoice that captured the change, not the moment the
//    merchant made the change. Within-cycle change timing is invisible.
// 2. Mid-cycle net-zero changes are invisible. Upgrade + downgrade within
//    the same billing cycle leaves no invoice diff; reported as nothing.
// 3. First-bill latency. A subscription created mid-cycle won't appear in
//    the "new" bucket until its first invoice fires (up to one cycle).
// 4. Paused → resumed appears as expansion at resume. Resume invoice
//    shows non-zero after a $0 paused cycle.
// Additional documented limitations:
// 5. Multi-line subscriptions with mixed price changes are aggregated
//    per-subscription (Q3=A); per-line attribution deferred.
// 6. Trial-to-paid transition is attributed to "new" at conversion time
//    (first paying invoice), not at trial start. Matches when MRR actually
//    begins. Implemented by skipping leading $0 invoices in Pass 1.
// 7. Interval-change subscriptions (e.g., monthly → annual mid-stream) are
//    edge cases. V1 uses the current sub state for monthly normalization;
//    if interval changed historically, historical normalization may drift.
//    Rare in ICP merchants.
// 8. Long trials (>30 days) miss the NEW event. The trial-create $0 invoice
//    falls outside the tool's 30-day invoice-fetch widening, so the synthesis
//    layer applies its SUPPRESS sentinel to sub.start_date and the latency
//    check in Pass 1 rejects the conversion invoice. Acceptable for V1; fix
//    requires either widening the invoice horizon (latency cost) or fetching
//    sub.trial_start/trial_end directly. Documented 2026-05-13.
// 9. Annual/long-interval sub churn uses sub.items pricing as a fallback
//    when the last invoice is outside the 30-day fetch widening. Percent-off
//    or amount-off discounts on the sub are NOT applied in this fallback —
//    the MRR loss reflects list price, not actual billed amount. May slightly
//    overstate churn for discounted long-interval subs. Documented 2026-05-13.

import type { StripeInvoiceLike, StripeInvoiceLineItemLike } from './invoiceEnriched';
import type { StripeSubscriptionLike } from './subscriptionEnriched';
import type { StripeProductLike } from './revenueByPlan';
import type { Period } from './types';
import { toMajor } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export type MrrMovementBucket = 'new' | 'expansion' | 'contraction' | 'churned';

export interface MrrMovementBucketRow {
  bucket: MrrMovementBucket;
  currency: string;
  amount: number;        // major units; signed (positive new/expansion, negative contraction/churned)
  event_count: number;
}

export interface MrrMovementEvent {
  bucket_type: MrrMovementBucket;
  date: number;                   // unix sec
  date_iso: string;               // YYYY-MM-DD
  subscription_id: string;
  customer_id: string | null;
  customer_display_name: string;  // resolved name | email | 'Unknown customer'
  plan_name: string;              // resolved via productById dual-shape lookup
  currency: string;
  amount: number;                 // major units; signed
  /** For expansion/contraction events, the pre-change monthly MRR. */
  prior_amount?: number;
}

export interface MrrMovementResult {
  kind: 'rows';
  rows: MrrMovementBucketRow[];
  events: MrrMovementEvent[];
  totals_by_currency: {
    [currency: string]: {
      new: number;
      expansion: number;
      contraction: number;        // stored as negative
      churned: number;            // stored as negative
      net: number;                // sum of all four
    };
  };
  truncated: boolean;
  metric_type: 'flow';            // Q6 Layer 2
  coverage_starts_at: string | null;   // earliest invoice ISO date observed in period
  definition: 'javelin_defined.mrr_movement';
  period: Period;
  as_of: number;
}

/** Minimal customer shape for display-name resolution. */
export interface StripeCustomerLike {
  id: string;
  name?: string | null;
  email?: string | null;
}

export interface MrrMovementInput {
  /** ALL invoices for the period (widened left for context). Movement
   *  detection compares consecutive invoices per subscription, so a wider
   *  fetch enables cleaner expansion/contraction detection at period edges. */
  invoices: StripeInvoiceLike[];
  activeSubscriptions: StripeSubscriptionLike[];   // active + past_due
  /** Subscriptions whose ended_at IS in the period; produces churned events. */
  canceledSubscriptions: StripeSubscriptionLike[];
  /** For plan-name resolution via productById fallback (Phase 2C-post-v2 pattern). */
  products?: StripeProductLike[];
  /** For customer display-name resolution; optional, falls back to "Unknown customer". */
  customers?: StripeCustomerLike[];
  period: Period;
  now: Date;
}

/** Internal shared output of {@link computeMrrMovementEvents}. Both
 *  `mrrMovement` (FLOW-by-bucket) and `growthAttribution` (FLOW-by-plan)
 *  consume this — the cap-at-50 + bucket aggregation in `mrrMovement` is
 *  a presentational layer on top of these uncapped events. */
export interface MrrMovementEventsResult {
  /** UNCAPPED events in generation order (new pass, then churned, then
   *  expansion/contraction). Consumers sort/cap as needed for their
   *  presentation surface. */
  events: MrrMovementEvent[];
  /** Earliest invoice ISO date observed within the period (LLM hedging
   *  signal). Null when no invoices in period. */
  coverage_starts_at: string | null;
  /** As-of timestamp (seconds since epoch). Mirrored from input.now. */
  as_of: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const EVENT_DETAIL_CAP = 50;

// First-bill latency window — how many days after sub.start_date is the
// first invoice plausibly the "actual first" invoice (vs. just the earliest
// fetched one for an older subscription whose history pre-dates the fetch
// window)? 35 days catches monthly billing with a small buffer for billing-
// day proration; rejects older subs where the fetched "first" invoice is
// really mid-life.
const NEW_BUCKET_LATENCY_WINDOW = 35 * 86400;

const COUNTED_INVOICE_STATUSES: ReadonlySet<string> = new Set([
  'paid',
  'open',
  'uncollectible',
]);

// interval → monthly multiplier, mirrors subscriptionEnriched.INTERVAL_TO_MONTHLY
const INTERVAL_TO_MONTHLY: Record<'day' | 'week' | 'month' | 'year', number> = {
  day: 365 / 12,
  week: 52 / 12,
  month: 1,
  year: 1 / 12,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildProductById(
  products: StripeProductLike[] | undefined,
): Map<string, StripeProductLike> {
  const map = new Map<string, StripeProductLike>();
  if (!products) return map;
  for (const p of products) map.set(p.id, p);
  return map;
}

function buildCustomerById(
  customers: StripeCustomerLike[] | undefined,
): Map<string, StripeCustomerLike> {
  const map = new Map<string, StripeCustomerLike>();
  if (!customers) return map;
  for (const c of customers) map.set(c.id, c);
  return map;
}

function isoDateUTC(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function inPeriod(t: number, period: Period): boolean {
  return t >= period.start && t <= period.end;
}

function invoiceFinalizedAt(invoice: StripeInvoiceLike): number {
  return invoice.status_transitions?.finalized_at ?? invoice.created;
}

/** Resolve invoice → subscription_id, defensive across legacy + new API shapes.
 *  Legacy: invoice.subscription (string ID).
 *  New (Stripe 2024-2025 API): invoice.parent.subscription_details.subscription.
 *  PCL 2026-05-11 finding confirmed both shapes coexist on production accounts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function invoiceSubscriptionId(invoice: any): string | null {
  // Legacy
  if (typeof invoice?.subscription === 'string' && invoice.subscription) {
    return invoice.subscription;
  }
  if (
    invoice?.subscription &&
    typeof invoice.subscription === 'object' &&
    typeof invoice.subscription.id === 'string'
  ) {
    return invoice.subscription.id;
  }
  // New shape
  const parentSub = invoice?.parent?.subscription_details?.subscription;
  if (typeof parentSub === 'string' && parentSub) return parentSub;
  if (parentSub && typeof parentSub === 'object' && typeof parentSub.id === 'string') {
    return parentSub.id;
  }
  return null;
}

function customerIdOf(sub: StripeSubscriptionLike): string | null {
  if (sub.customer == null) return null;
  return typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
}

function resolveCustomerDisplayName(
  customerId: string | null,
  customerById: Map<string, StripeCustomerLike>,
): string {
  if (!customerId) return 'Unknown customer';
  const c = customerById.get(customerId);
  if (!c) return 'Unknown customer';
  if (c.name && c.name.trim()) return c.name;
  if (c.email && c.email.trim()) return c.email;
  return 'Unknown customer';
}

/** Dual-shape plan-name resolution — same pattern as revenueByPlanBilled.
 *  Tries new shape first (pricing.price_details.product), then legacy paths. */
function planNameFromLine(
  line: StripeInvoiceLineItemLike,
  productById: Map<string, StripeProductLike>,
): string {
  // New shape
  const newProductId = line.pricing?.price_details?.product;
  if (typeof newProductId === 'string' && newProductId) {
    const product = productById.get(newProductId);
    if (product?.name) return product.name;
  }
  // Legacy nickname
  if (line.price?.nickname) return line.price.nickname;
  // Legacy product ID
  if (typeof line.price?.product === 'string' && line.price.product) {
    const product = productById.get(line.price.product);
    if (product?.name) return product.name;
  }
  // Legacy expanded product object
  if (
    line.price?.product &&
    typeof line.price.product === 'object' &&
    line.price.product.name
  ) {
    return line.price.product.name;
  }
  return 'unattributed';
}

/** Pick a representative plan name for an invoice. Uses the first recurring
 *  line; falls back to first line; falls back to 'unattributed'. */
function planNameForInvoice(
  invoice: StripeInvoiceLike,
  productById: Map<string, StripeProductLike>,
): string {
  const lines = invoice.lines?.data ?? [];
  // Prefer recurring lines
  const recurringLine = lines.find(
    (l) => isRecurringLine(l) && (l.amount ?? 0) > 0,
  );
  if (recurringLine) return planNameFromLine(recurringLine, productById);
  // Fall back to first line
  if (lines.length > 0) return planNameFromLine(lines[0], productById);
  return 'unattributed';
}

/** Is this invoice line a recurring subscription line (not a proration / one-time)?
 *  Used to filter out prorating lines so we measure the steady-state MRR
 *  change rather than the prorated charge amount. Dual-shape defensive: */
function isRecurringLine(line: StripeInvoiceLineItemLike): boolean {
  // New shape: pricing.type === 'recurring'
  if (line.pricing?.type === 'recurring') return true;
  if (line.pricing?.type && line.pricing.type !== 'recurring') return false;
  // Legacy shape: price.recurring is non-null
  if (line.price?.recurring) return true;
  // Defensive: when we can't tell, assume recurring (better than dropping data).
  return true;
}

/** Compute monthly MRR directly from sub.items pricing — used as a churn-pass
 *  fallback when no invoice for the sub is in our fetch window (e.g., annual
 *  subs whose last invoice was 12 months ago, outside the invoice-fetcher's
 *  30-day widening). Discounts are NOT applied (limitation #9).
 *  Returns major units in the sub's primary item currency. */
function monthlyAmountFromSubItems(
  sub: StripeSubscriptionLike,
): { amount: number; currency: string } {
  const items = sub.items?.data ?? [];
  const firstItem = items[0];
  if (!firstItem?.price?.recurring) return { amount: 0, currency: 'usd' };
  const interval = firstItem.price.recurring.interval;
  const intervalCount = firstItem.price.recurring.interval_count ?? 1;
  const currency = firstItem.price.currency ?? 'usd';
  const monthlyFactor = INTERVAL_TO_MONTHLY[interval] / intervalCount;

  let totalMinor = 0;
  for (const item of items) {
    if (!item.price?.recurring) continue;
    const unit = item.price.unit_amount ?? 0;
    const qty = item.quantity ?? 1;
    if (unit <= 0) continue;
    totalMinor += unit * qty;
  }
  return {
    amount: toMajor(totalMinor * monthlyFactor, currency),
    currency,
  };
}

/** Plan-name resolution from sub.items (churn fallback path). Mirrors
 *  planNameFromLine's resolution chain but reads from the subscription item
 *  rather than an invoice line. */
function planNameFromSubItems(
  sub: StripeSubscriptionLike,
  productById: Map<string, StripeProductLike>,
): string {
  const item = sub.items?.data?.[0];
  if (!item) return 'unattributed';
  if (item.price?.nickname) return item.price.nickname;
  if (typeof item.price?.product === 'string' && item.price.product) {
    const product = productById.get(item.price.product);
    if (product?.name) return product.name;
  }
  if (
    item.price?.product &&
    typeof item.price.product === 'object' &&
    item.price.product.name
  ) {
    return item.price.product.name;
  }
  return 'unattributed';
}

/** Sum recurring line amounts on an invoice and normalize to monthly
 *  using the subscription's billing interval (from current state).
 *  Returns major units (not minor). */
function monthlyAmountFromInvoiceForSub(
  invoice: StripeInvoiceLike,
  sub: StripeSubscriptionLike,
): number {
  const firstItem = sub.items?.data?.[0];
  const interval = firstItem?.price?.recurring?.interval ?? 'month';
  const intervalCount = firstItem?.price?.recurring?.interval_count ?? 1;
  const monthlyFactor = INTERVAL_TO_MONTHLY[interval] / intervalCount;

  let recurringMinor = 0;
  for (const line of invoice.lines?.data ?? []) {
    if (!isRecurringLine(line)) continue;
    const amt = line.amount ?? 0;
    if (amt <= 0) continue;
    recurringMinor += amt;
  }

  return toMajor(recurringMinor * monthlyFactor, invoice.currency);
}

// ── Shared event-generation helper ───────────────────────────────────────────
//
// Returns UNCAPPED, unsorted events. `mrrMovement` adds the bucket-aggregation
// + presentation cap on top; `growthAttribution` aggregates by plan instead.
// Extracted 2026-05-13 (Phase 2E refactor A) so the cap stays a presentational
// concern, not a correctness ceiling for downstream aggregation.

export function computeMrrMovementEvents(input: MrrMovementInput): MrrMovementEventsResult {
  const {
    invoices,
    activeSubscriptions,
    canceledSubscriptions,
    products,
    customers,
    period,
    now,
  } = input;
  const nowSec = Math.floor(now.getTime() / 1000);

  const productById = buildProductById(products);
  const customerById = buildCustomerById(customers);

  // Combine all subs for full lookup; active + canceled
  const allSubs = [...activeSubscriptions, ...canceledSubscriptions];
  const subById = new Map<string, StripeSubscriptionLike>();
  for (const s of allSubs) subById.set(s.id, s);

  // Group counted invoices by subscription, sorted by finalized_at asc.
  // We use ALL invoices (not just in-period) so consecutive-pair comparison
  // works at period edges.
  const invoicesBySub = new Map<string, StripeInvoiceLike[]>();
  let earliestInPeriod: number | null = null;
  for (const invoice of invoices) {
    if (!invoice.status || !COUNTED_INVOICE_STATUSES.has(invoice.status)) continue;
    const subId = invoiceSubscriptionId(invoice);
    if (!subId) continue;
    const finalized = invoiceFinalizedAt(invoice);
    if (inPeriod(finalized, period)) {
      if (earliestInPeriod == null || finalized < earliestInPeriod) {
        earliestInPeriod = finalized;
      }
    }
    if (!invoicesBySub.has(subId)) invoicesBySub.set(subId, []);
    invoicesBySub.get(subId)!.push(invoice);
  }
  for (const invs of invoicesBySub.values()) {
    invs.sort((a, b) => invoiceFinalizedAt(a) - invoiceFinalizedAt(b));
  }

  const events: MrrMovementEvent[] = [];

  // ── Pass 1: NEW events ─────────────────────────────────────────────────
  // A "new" event fires when a subscription's FIRST PAYING invoice lands
  // in the period. We skip leading $0 invoices so trial-to-paid conversions
  // attribute to the conversion invoice (limitation #6), not the $0 trial-
  // create invoice that monthlyAmount=0 would otherwise drop entirely.
  //
  // Sub.start_date is administrative metadata; actual MRR contribution
  // begins with the first paid invoice. The 35-day latency window from
  // sub.start_date prevents:
  //   - Mid-life billing for old subs whose earlier history is outside our
  //     fetched invoice window (their "first fetched" invoice would be a
  //     subscription_cycle, not the genuine first).
  //   - Pause-resumed or discount-expired subs from firing false NEW events
  //     when a $0-streak transitions to paying.
  for (const sub of allSubs) {
    const subInvoices = invoicesBySub.get(sub.id) ?? [];
    if (subInvoices.length === 0) continue;          // first-bill latency
    // Find first invoice with positive monthlyAmount — skipping any leading
    // $0 invoices (trial-create, paused-cycle, full-discount-cycle).
    let firstPaidInvoice: StripeInvoiceLike | null = null;
    let firstPaidMonthly = 0;
    for (const inv of subInvoices) {
      const monthly = monthlyAmountFromInvoiceForSub(inv, sub);
      if (monthly > 0) {
        firstPaidInvoice = inv;
        firstPaidMonthly = monthly;
        break;
      }
    }
    if (!firstPaidInvoice) continue;
    const firstDate = invoiceFinalizedAt(firstPaidInvoice);
    if (!inPeriod(firstDate, period)) continue;       // first paid invoice not in this period
    // Latency window from sub.start_date: distinguishes genuine trial-to-paid
    // (short gap) from pause-resumed / discount-expired (long gap from
    // sub.start_date to first paid invoice in our fetch).
    if (firstDate < sub.start_date) continue;
    if (firstDate - sub.start_date > NEW_BUCKET_LATENCY_WINDOW) continue;
    const custId = customerIdOf(sub);
    events.push({
      bucket_type: 'new',
      date: firstDate,
      date_iso: isoDateUTC(firstDate),
      subscription_id: sub.id,
      customer_id: custId,
      customer_display_name: resolveCustomerDisplayName(custId, customerById),
      plan_name: planNameForInvoice(firstPaidInvoice, productById),
      currency: firstPaidInvoice.currency,
      amount: firstPaidMonthly,
    });
  }

  // ── Pass 2: CHURNED events (sub.ended_at IN period) ────────────────────
  // Primary path: compute MRR loss from the sub's last invoice in our fetch.
  // Fallback path: when no invoice for the sub is in fetch AND the sub is
  // older than NEW_BUCKET_LATENCY_WINDOW (i.e., genuinely a long-running sub
  // whose last invoice predates the 30-day invoice-fetch widening), compute
  // MRR directly from sub.items. This covers annual/quarterly/semi-annual
  // subs whose last billing was up to 12 months ago. Subs created and
  // canceled within ~35 days that have no invoice are skipped (likely never
  // billed; firing churn for them would be a false positive).
  for (const sub of allSubs) {
    if (sub.ended_at == null || !inPeriod(sub.ended_at, period)) continue;
    const subInvoices = invoicesBySub.get(sub.id) ?? [];
    const custId = customerIdOf(sub);
    let monthlyAmount: number;
    let currency: string;
    let planName: string;
    if (subInvoices.length > 0) {
      const lastInvoice = subInvoices[subInvoices.length - 1];
      monthlyAmount = monthlyAmountFromInvoiceForSub(lastInvoice, sub);
      currency = lastInvoice.currency;
      planName = planNameForInvoice(lastInvoice, productById);
    } else {
      // Sub-items fallback. Only fire when sub is old enough that the
      // missing invoice is plausibly due to fetch-window cap, not "never
      // billed."
      if (period.start - sub.start_date <= NEW_BUCKET_LATENCY_WINDOW) continue;
      const fromItems = monthlyAmountFromSubItems(sub);
      monthlyAmount = fromItems.amount;
      currency = fromItems.currency;
      planName = planNameFromSubItems(sub, productById);
    }
    if (monthlyAmount <= 0) continue;
    events.push({
      bucket_type: 'churned',
      date: sub.ended_at,
      date_iso: isoDateUTC(sub.ended_at),
      subscription_id: sub.id,
      customer_id: custId,
      customer_display_name: resolveCustomerDisplayName(custId, customerById),
      plan_name: planName,
      currency,
      amount: -monthlyAmount,             // sign-flipped (loss)
    });
  }

  // ── Pass 3: EXPANSION / CONTRACTION (consecutive invoice diffs) ───────
  for (const [subId, invs] of invoicesBySub) {
    if (invs.length < 2) continue;
    const sub = subById.get(subId);
    if (!sub) continue;        // orphan invoice (rare; sub fetch missed)
    for (let i = 1; i < invs.length; i++) {
      const prev = invs[i - 1];
      const curr = invs[i];
      const currDate = invoiceFinalizedAt(curr);
      if (!inPeriod(currDate, period)) continue;
      const prevMonthly = monthlyAmountFromInvoiceForSub(prev, sub);
      const currMonthly = monthlyAmountFromInvoiceForSub(curr, sub);
      const delta = currMonthly - prevMonthly;
      if (delta === 0) continue;
      const bucket: MrrMovementBucket = delta > 0 ? 'expansion' : 'contraction';
      const custId = customerIdOf(sub);
      events.push({
        bucket_type: bucket,
        date: currDate,
        date_iso: isoDateUTC(currDate),
        subscription_id: sub.id,
        customer_id: custId,
        customer_display_name: resolveCustomerDisplayName(custId, customerById),
        plan_name: planNameForInvoice(curr, productById),
        currency: curr.currency,
        amount: delta,                    // signed
        prior_amount: prevMonthly,
      });
    }
  }

  return {
    events,
    coverage_starts_at: earliestInPeriod ? isoDateUTC(earliestInPeriod) : null,
    as_of: nowSec,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function mrrMovement(input: MrrMovementInput): MrrMovementResult {
  const { events, coverage_starts_at, as_of } = computeMrrMovementEvents(input);

  // ── Aggregate to bucket totals (per-currency) ─────────────────────────
  // bucketTotals: Map<bucket|currency, { amount_major_signed, event_count }>
  const bucketKeyed = new Map<
    string,
    { bucket: MrrMovementBucket; currency: string; amount: number; event_count: number }
  >();
  // Per-currency rollup
  const perCurrency = new Map<
    string,
    { new: number; expansion: number; contraction: number; churned: number }
  >();

  for (const e of events) {
    const key = `${e.bucket_type}|${e.currency}`;
    const existing = bucketKeyed.get(key);
    if (existing) {
      existing.amount += e.amount;
      existing.event_count += 1;
    } else {
      bucketKeyed.set(key, {
        bucket: e.bucket_type,
        currency: e.currency,
        amount: e.amount,
        event_count: 1,
      });
    }
    const cur = perCurrency.get(e.currency) ?? {
      new: 0,
      expansion: 0,
      contraction: 0,
      churned: 0,
    };
    cur[e.bucket_type] += e.amount;
    perCurrency.set(e.currency, cur);
  }

  // Currency-rollup sort priority — most-active currency first
  const currencyActivity = new Map<string, number>();
  for (const [currency, sums] of perCurrency) {
    const total = Math.abs(sums.new) + Math.abs(sums.expansion) + Math.abs(sums.contraction) + Math.abs(sums.churned);
    currencyActivity.set(currency, total);
  }

  const bucketOrder: Record<MrrMovementBucket, number> = {
    new: 0,
    expansion: 1,
    contraction: 2,
    churned: 3,
  };
  const rows = Array.from(bucketKeyed.values()).sort((a, b) => {
    const aA = currencyActivity.get(a.currency) ?? 0;
    const bA = currencyActivity.get(b.currency) ?? 0;
    if (aA !== bA) return bA - aA;          // dominant currency first
    return bucketOrder[a.bucket] - bucketOrder[b.bucket];    // then by bucket order
  });

  // Sort events by absolute amount desc; cap at top-N; set truncated flag
  events.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const truncated = events.length > EVENT_DETAIL_CAP;
  const cappedEvents = truncated ? events.slice(0, EVENT_DETAIL_CAP) : events;

  // Build totals_by_currency
  const totals_by_currency: MrrMovementResult['totals_by_currency'] = {};
  for (const [currency, sums] of perCurrency) {
    totals_by_currency[currency] = {
      new: sums.new,
      expansion: sums.expansion,
      contraction: sums.contraction,
      churned: sums.churned,
      net: sums.new + sums.expansion + sums.contraction + sums.churned,
    };
  }

  return {
    kind: 'rows',
    rows,
    events: cappedEvents,
    totals_by_currency,
    truncated,
    metric_type: 'flow',
    coverage_starts_at,
    definition: 'javelin_defined.mrr_movement',
    period: input.period,
    as_of,
  };
}
