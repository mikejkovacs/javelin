import { tool } from 'ai';
import { z } from 'zod';
import type Stripe from 'stripe';
import { mrrMovement } from '../../metrics/mrrMovement';
import type { StripeInvoiceLike } from '../../metrics/invoiceEnriched';
import type { StripeSubscriptionLike } from '../../metrics/subscriptionEnriched';
import type { StripeProductLike } from '../../metrics/revenueByPlan';
import {
  fetchInvoices,
  fetchCanceledSubscriptions,
  fetchProducts,
} from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const MRR_MOVEMENT_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
  })
  .strict();

export function buildMrrMovementTool(accountId: string) {
  return tool({
    description:
      // Q6 Layer 1 — flow/state lexical guard. The "FLOW, not STATE" framing
      // is repeated in this description AND in the result envelope's
      // metric_type:'flow' field (Q6 Layer 2). The mrr tool's output carries
      // metric_type:'state' as the lexical counterpart.
      'Decomposes MRR CHANGES over a period into four buckets: new (subs created), expansion (upgrades), contraction (downgrades), churned (subs ended). This is a FLOW metric (changes over a period), NOT a STATE metric — never combine numerically with the `mrr` tool output (which reports the current run-rate). For "how did my MRR change last month?", "what drove MRR growth?", "show me expansion vs contraction" questions. For plan-level attribution of growth ("which plans are growing?" / "where is growth coming from?"), use `growth_attribution` instead. Returns per-bucket totals per currency PLUS a per-event detail array (top 50 by absolute amount; truncated flag set if more) with customer + plan attribution on each event. Multi-currency: rows keyed by (bucket, currency); no FX, no cross-currency sums (RULE #8). Uses invoice history (multi-year retention) — works for any time window with sufficient invoice coverage. Movement events are stamped with the invoice date that captured the change (not the exact change moment); within-cycle change timing is invisible. Inputs: start/end ISO.',
    inputSchema: MRR_MOVEMENT_INPUT_SCHEMA,
    execute: async ({ start, end }) => {
      try {
        const stripe = getStripeClient();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };

        // ── Latency redesign 2026-05-13 (design lock decision 1B) ────────
        // Previously this tool fanned out to FIVE parallel fetches per call:
        //   fetchInvoices(period) + fetchCanceledSubscriptions(period)
        //   + fetchActiveSubscriptions() [UNBOUNDED LIFETIME]
        //   + fetchProducts() + fetchCustomers() [UNBOUNDED LIFETIME]
        //
        // The two unbounded lifetime fetches dominated cold-path cost on
        // large accounts (Merchant B first-question 2026-05-12 took
        // 3-4 min wall-clock; ~1500 active subs, multi-currency, 2-3yr
        // history). Merchant A warm baseline = 14.7s for a comparable
        // question — the fetchCustomers/fetchActiveSubscriptions deltas
        // scale linearly with merchant size and would have dominated.
        //
        // After: only period-bounded fetches. Active subscriptions are
        // SYNTHESIZED from invoice references — invoices in our window
        // contain enough info (subscription_id, customer, recurring line
        // interval, billing_reason='subscription_create' as a definitive
        // first-invoice signal) to satisfy what mrrMovement reads.
        //
        // Trade: customer display names degrade to 'Unknown customer' in
        // event detail (the metric primitive's documented fallback). A
        // future enhancement can re-enrich the top-50 events via targeted
        // customers.retrieve() calls (50 parallel ~200ms wall-clock).
        const [invoices, canceledSubscriptions, products] = await Promise.all([
          fetchInvoices(stripe, accountId, period),
          fetchCanceledSubscriptions(stripe, accountId, period),
          fetchProducts(stripe, accountId),
        ]);

        const canceledIds = new Set(canceledSubscriptions.map((s) => s.id));
        const activeSubscriptions = synthesizeActiveSubscriptionsFromInvoices(
          invoices,
          canceledIds,
          period.start,
        );

        const result = mrrMovement({
          invoices: invoices as unknown as StripeInvoiceLike[],
          activeSubscriptions,
          canceledSubscriptions:
            canceledSubscriptions as unknown as StripeSubscriptionLike[],
          products: products as unknown as StripeProductLike[],
          // Intentionally empty — display names fall back to 'Unknown customer'
          // (documented v1 trade-off; future enhancement enriches top-50 events).
          customers: [],
          period,
          now: new Date(),
        });

        // Correctness observability — one structured log line per call so a
        // grep '[MRR_MOVEMENT]' on Vercel logs reveals whether all-zero output
        // (Merchant B-class symptom 2026-05-12) corresponds to empty inputs
        // (legitimate) or rich inputs that produced no events (bug). Distinct
        // from [TIMING] which only carries latency.
        logMrrMovementResult({
          accountId,
          start,
          end,
          inputCounts: {
            invoices: invoices.length,
            active_synth: activeSubscriptions.length,
            canceled: canceledSubscriptions.length,
          },
          result,
        });

        return result;
      } catch (err) {
        console.error('[ask] mrr_movement tool execute() failed:', err);
        throw err;
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Correctness observability log — emits a single structured line per call.
//
// Distinct from [TIMING] (latency-only). Lets a `grep '[MRR_MOVEMENT]'` on
// Vercel logs distinguish "all-zero output because inputs were empty"
// (legitimate) from "all-zero output despite rich inputs" (bug). Merchant B
// Studio's 2026-05-12 zero-MRR-movement report was un-diagnosable without
// this. by_currency carries both event_counts and signed amounts per bucket
// so we can spot "events fired but summed to zero" vs "no events fired".
// ─────────────────────────────────────────────────────────────────────────────

interface MrrMovementBucketSummary {
  events: number;
  amount: number;
}

interface LogMrrMovementResultInput {
  accountId: string;
  start: string;
  end: string;
  inputCounts: { invoices: number; active_synth: number; canceled: number };
  result: ReturnType<typeof mrrMovement>;
}

function logMrrMovementResult(input: LogMrrMovementResultInput): void {
  const { accountId, start, end, inputCounts, result } = input;

  // event_count per (bucket, currency) lives on result.rows; signed totals
  // per currency live on result.totals_by_currency. Combine both into one
  // per-currency view keyed by bucket name.
  const byCurrency: Record<
    string,
    {
      new: MrrMovementBucketSummary;
      expansion: MrrMovementBucketSummary;
      contraction: MrrMovementBucketSummary;
      churned: MrrMovementBucketSummary;
      net: number;
    }
  > = {};
  for (const [currency, sums] of Object.entries(result.totals_by_currency)) {
    byCurrency[currency] = {
      new: { events: 0, amount: sums.new },
      expansion: { events: 0, amount: sums.expansion },
      contraction: { events: 0, amount: sums.contraction },
      churned: { events: 0, amount: sums.churned },
      net: sums.net,
    };
  }
  for (const row of result.rows) {
    const cur = byCurrency[row.currency];
    if (cur) cur[row.bucket].events = row.event_count;
  }

  console.log(
    `[MRR_MOVEMENT] result ${JSON.stringify({
      accountId,
      period: `${start}..${end}`,
      inputs: inputCounts,
      by_currency: byCurrency,
      truncated_events: result.truncated,
      coverage_starts_at: result.coverage_starts_at,
    })}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesis helpers — exported for unit tests but not part of the tool's
// runtime API. The mrrMovement metric primitive remains untouched (M2-
// validated); we only change WHERE the inputs come from.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve an invoice → subscription_id, defensive across legacy + new Stripe
 * API shapes. Mirrors the helper in lib/metrics/mrrMovement.ts (kept private
 * there); duplicated here to keep the metric primitive's API surface minimal.
 *   Legacy:  invoice.subscription (string ID or expanded object)
 *   New:     invoice.parent.subscription_details.subscription (string/object)
 */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inv = invoice as any;
  if (typeof inv?.subscription === 'string' && inv.subscription) {
    return inv.subscription;
  }
  if (
    inv?.subscription &&
    typeof inv.subscription === 'object' &&
    typeof inv.subscription.id === 'string'
  ) {
    return inv.subscription.id;
  }
  const parentSub = inv?.parent?.subscription_details?.subscription;
  if (typeof parentSub === 'string' && parentSub) return parentSub;
  if (parentSub && typeof parentSub === 'object' && typeof parentSub.id === 'string') {
    return parentSub.id;
  }
  return null;
}

function invoiceFinalizedAt(invoice: Stripe.Invoice): number {
  return invoice.status_transitions?.finalized_at ?? invoice.created;
}

/**
 * Synthesize minimal `StripeSubscriptionLike` objects from invoice references.
 *
 * The `mrrMovement` primitive reads these fields from each sub:
 *   - `id` — joined against invoicesBySub
 *   - `customer` — for `customer_id` in event output (display name resolved
 *     by primitive via customerById; here we set it to a string ID and let
 *     the primitive's fallback produce 'Unknown customer')
 *   - `start_date` — used in the 35-day latency window check that filters
 *     out spurious NEW events for older subs whose history pre-dates the
 *     invoice fetch window. We use `billing_reason === 'subscription_create'`
 *     as a definitive first-invoice signal — when present, set start_date to
 *     that invoice's finalized_at (always passes the latency check). When
 *     absent, set start_date to `period.start - 365d`, which fails the
 *     latency check and correctly suppresses NEW events for older subs.
 *   - `ended_at` — null for active subs; canceled subs come from the
 *     `canceledSubscriptions` input and are filtered out here.
 *   - `items[0].price.recurring.{interval, interval_count}` — derived from
 *     the latest invoice's first recurring line. Note: if a sub changed its
 *     billing interval mid-stream (rare; documented V1 limitation #7 in
 *     mrrMovement.ts), this synthesizes the *current* interval — same as
 *     the previous implementation, since the live Stripe sub object would
 *     also reflect the current interval.
 *
 * The metric primitive doesn't read `status`, `canceled_at`, `trial_end`,
 * `discounts`, `cancellation_details`, or `pause_collection`, so those are
 * filled with placeholder values.
 */
export function synthesizeActiveSubscriptionsFromInvoices(
  invoices: Stripe.Invoice[],
  canceledIds: Set<string>,
  periodStart: number,
): StripeSubscriptionLike[] {
  const bySubId = new Map<string, Stripe.Invoice[]>();
  for (const inv of invoices) {
    const subId = invoiceSubscriptionId(inv);
    if (!subId) continue;
    if (canceledIds.has(subId)) continue;
    const arr = bySubId.get(subId);
    if (arr) arr.push(inv);
    else bySubId.set(subId, [inv]);
  }

  const result: StripeSubscriptionLike[] = [];
  // "Far past" sentinel — far enough back that the primitive's
  // NEW_BUCKET_LATENCY_WINDOW (35 days) check correctly rejects this sub
  // from generating a NEW event. 365 days back is comfortable headroom.
  const SUPPRESS_NEW_START_DATE = periodStart - 365 * 86400;

  for (const [subId, invs] of bySubId) {
    invs.sort((a, b) => invoiceFinalizedAt(a) - invoiceFinalizedAt(b));
    const earliest = invs[0];
    const latest = invs[invs.length - 1];

    // billing_reason='subscription_create' is Stripe's definitive first-
    // invoice marker. Trust it when present; fall through to suppression
    // when not present (covers older subs that bill in our window but
    // were created before the invoice fetch window).
    const isGenuineFirst =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (earliest as any).billing_reason === 'subscription_create';
    const startDate = isGenuineFirst
      ? invoiceFinalizedAt(earliest)
      : SUPPRESS_NEW_START_DATE;

    // Derive billing interval from a recurring line on the latest invoice.
    // Dual-shape: new API uses `pricing.recurring_details`, legacy uses
    // `price.recurring`. Defaults to monthly/1 when nothing matches.
    let interval: 'day' | 'week' | 'month' | 'year' = 'month';
    let intervalCount = 1;
    const lines = latest.lines?.data ?? [];
    for (const line of lines) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const l = line as any;
      const recurring =
        l?.pricing?.recurring_details ?? l?.price?.recurring ?? null;
      if (
        recurring?.interval &&
        ['day', 'week', 'month', 'year'].includes(recurring.interval)
      ) {
        interval = recurring.interval as 'day' | 'week' | 'month' | 'year';
        intervalCount =
          typeof recurring.interval_count === 'number'
            ? recurring.interval_count
            : 1;
        break;
      }
    }

    // Customer reference. The metric handles both string and { id } shapes,
    // so we pass through whichever form the invoice carries. With
    // `expand: ['data.customer']` on a future fetcher upgrade this would be
    // an object; today it's a string ID, which is sufficient for the
    // primitive's customer_id derivation. Display names default to
    // 'Unknown customer' since `customers: []` is passed to the primitive.
    let customer: string | { id: string } | null = null;
    if (typeof latest.customer === 'string' && latest.customer) {
      customer = latest.customer;
    } else if (
      latest.customer &&
      typeof latest.customer === 'object' &&
      'id' in (latest.customer as object) &&
      typeof (latest.customer as { id: unknown }).id === 'string'
    ) {
      customer = { id: (latest.customer as { id: string }).id };
    }
    if (customer == null) continue; // can't attribute — skip

    // Cast: we don't fill every StripeSubscriptionLike field (status,
    // canceled_at, trial_end, etc.) because the mrrMovement primitive
    // doesn't read them. The shape is internally consistent for our
    // consumer.
    const synthesized = {
      id: subId,
      customer,
      status: 'active',
      start_date: startDate,
      canceled_at: null,
      ended_at: null,
      trial_end: null,
      items: {
        data: [
          {
            price: {
              recurring: { interval, interval_count: intervalCount },
            },
          },
        ],
      },
    } as unknown as StripeSubscriptionLike;

    result.push(synthesized);
  }

  return result;
}
