import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import {
  MRR_MOVEMENT_INPUT_SCHEMA,
  invoiceSubscriptionId,
  synthesizeActiveSubscriptionsFromInvoices,
} from './mrrMovementTool';

describe('MRR_MOVEMENT_INPUT_SCHEMA', () => {
  it('accepts valid ISO date range', () => {
    expect(() =>
      MRR_MOVEMENT_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
      }),
    ).not.toThrow();
  });

  it('rejects malformed dates', () => {
    expect(() =>
      MRR_MOVEMENT_INPUT_SCHEMA.parse({
        start: '2026-13-45',
        end: '2026-03-31',
      }),
    ).toThrow();
  });

  it('rejects extra fields (strict mode)', () => {
    expect(() =>
      MRR_MOVEMENT_INPUT_SCHEMA.parse({
        start: '2026-03-01',
        end: '2026-03-31',
        granularity: 'month',  // mrr_movement is rows-only in V1 (no series)
      }),
    ).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() =>
      MRR_MOVEMENT_INPUT_SCHEMA.parse({
        start: '2026-03-01',
      }),
    ).toThrow();
  });

  it('accepts long time windows (F1 has no period cap)', () => {
    // Q1=A locked design: no 30-day or other period cap. Invoice retention
    // is multi-year on Stripe.
    expect(() =>
      MRR_MOVEMENT_INPUT_SCHEMA.parse({
        start: '2025-01-01',
        end: '2026-04-30',
      }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Latency redesign (decision 1B, 2026-05-13) — synthesis helper tests
// ─────────────────────────────────────────────────────────────────────────────

// Helper — minimal invoice factory. Casts through `unknown` because we
// fill only the fields the synthesis helpers actually read.
function makeInvoice(opts: {
  subscription?: string;
  parentSub?: string;
  customer?: string | { id: string };
  finalizedAt?: number;
  created?: number;
  billingReason?: string;
  intervalNew?: { interval: 'day' | 'week' | 'month' | 'year'; interval_count?: number };
  intervalLegacy?: { interval: 'day' | 'week' | 'month' | 'year'; interval_count?: number };
}): Stripe.Invoice {
  const lines: unknown[] = [];
  if (opts.intervalNew) {
    lines.push({ pricing: { recurring_details: opts.intervalNew } });
  }
  if (opts.intervalLegacy) {
    lines.push({ price: { recurring: opts.intervalLegacy } });
  }
  const inv: Record<string, unknown> = {
    id: `in_${Math.random().toString(36).slice(2, 10)}`,
    customer: opts.customer ?? 'cus_default',
    created: opts.created ?? 1_700_000_000,
    status_transitions: {
      finalized_at: opts.finalizedAt ?? opts.created ?? 1_700_000_000,
    },
    billing_reason: opts.billingReason ?? 'subscription_cycle',
    lines: { data: lines },
  };
  if (opts.subscription) inv.subscription = opts.subscription;
  if (opts.parentSub) {
    inv.parent = { subscription_details: { subscription: opts.parentSub } };
  }
  return inv as unknown as Stripe.Invoice;
}

describe('invoiceSubscriptionId', () => {
  it('reads legacy invoice.subscription string', () => {
    const inv = makeInvoice({ subscription: 'sub_legacy_1' });
    expect(invoiceSubscriptionId(inv)).toBe('sub_legacy_1');
  });

  it('reads new-shape parent.subscription_details.subscription', () => {
    const inv = makeInvoice({ parentSub: 'sub_new_1' });
    expect(invoiceSubscriptionId(inv)).toBe('sub_new_1');
  });

  it('prefers legacy when both shapes present', () => {
    // Defensive: invoices in flight may carry both. Legacy wins for
    // backward-compat (existing tests/fixtures use legacy paths).
    const inv = makeInvoice({
      subscription: 'sub_legacy_win',
      parentSub: 'sub_new_lose',
    });
    expect(invoiceSubscriptionId(inv)).toBe('sub_legacy_win');
  });

  it('returns null when no subscription reference present', () => {
    const inv = makeInvoice({}); // no subscription, no parent
    expect(invoiceSubscriptionId(inv)).toBeNull();
  });

  it('handles expanded-object subscription shape', () => {
    const inv = makeInvoice({}) as unknown as Record<string, unknown>;
    inv.subscription = { id: 'sub_expanded_1' };
    expect(invoiceSubscriptionId(inv as unknown as Stripe.Invoice)).toBe(
      'sub_expanded_1',
    );
  });
});

describe('synthesizeActiveSubscriptionsFromInvoices', () => {
  const PERIOD_START = 1_775_001_600; // 2026-04-01 UTC

  it('returns empty array when no invoices', () => {
    expect(
      synthesizeActiveSubscriptionsFromInvoices([], new Set(), PERIOD_START),
    ).toEqual([]);
  });

  it('skips invoices with no subscription reference', () => {
    const inv = makeInvoice({}); // no subscription / parent
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv],
      new Set(),
      PERIOD_START,
    );
    expect(result).toEqual([]);
  });

  it('skips subs whose ID is in canceledIds (avoids double-counting)', () => {
    // Canceled subs come from canceledSubscriptions input path; synthesis
    // must not also emit them as active or both paths fire events for the
    // same sub.
    const inv = makeInvoice({
      subscription: 'sub_canceled',
      customer: 'cus_a',
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv],
      new Set(['sub_canceled']),
      PERIOD_START,
    );
    expect(result).toEqual([]);
  });

  it('produces one sub per unique subscription_id across multiple invoices', () => {
    const inv1 = makeInvoice({
      subscription: 'sub_a',
      customer: 'cus_1',
      finalizedAt: PERIOD_START + 100,
    });
    const inv2 = makeInvoice({
      subscription: 'sub_a',
      customer: 'cus_1',
      finalizedAt: PERIOD_START + 200,
    });
    const inv3 = makeInvoice({
      subscription: 'sub_b',
      customer: 'cus_2',
      finalizedAt: PERIOD_START + 300,
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv1, inv2, inv3],
      new Set(),
      PERIOD_START,
    );
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id).sort()).toEqual(['sub_a', 'sub_b']);
  });

  it('sets start_date to invoice.finalized_at when billing_reason is subscription_create', () => {
    // Definitive first-invoice signal — the primitive's 35-day latency
    // window check then PASSES for this sub, allowing a NEW event to fire.
    const firstInvoiceTs = PERIOD_START + 1000;
    const inv = makeInvoice({
      subscription: 'sub_new_create',
      customer: 'cus_x',
      finalizedAt: firstInvoiceTs,
      billingReason: 'subscription_create',
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv],
      new Set(),
      PERIOD_START,
    );
    expect(result).toHaveLength(1);
    expect(result[0].start_date).toBe(firstInvoiceTs);
  });

  it('sets start_date far in past when billing_reason is NOT subscription_create', () => {
    // Suppresses spurious NEW events for older subs whose history pre-
    // dates the invoice fetch window. The primitive's 35-day latency
    // check then FAILS (we're 365d back), correctly filtering this out.
    const inv = makeInvoice({
      subscription: 'sub_old',
      customer: 'cus_y',
      finalizedAt: PERIOD_START + 1000,
      billingReason: 'subscription_cycle', // not "create"
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv],
      new Set(),
      PERIOD_START,
    );
    expect(result).toHaveLength(1);
    expect(result[0].start_date).toBe(PERIOD_START - 365 * 86400);
  });

  it('derives interval from new-shape pricing.recurring_details', () => {
    const inv = makeInvoice({
      subscription: 'sub_new_shape',
      customer: 'cus_a',
      intervalNew: { interval: 'year', interval_count: 1 },
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv],
      new Set(),
      PERIOD_START,
    );
    expect(result[0].items.data[0].price.recurring?.interval).toBe('year');
    expect(result[0].items.data[0].price.recurring?.interval_count).toBe(1);
  });

  it('derives interval from legacy price.recurring shape', () => {
    const inv = makeInvoice({
      subscription: 'sub_legacy_shape',
      customer: 'cus_a',
      intervalLegacy: { interval: 'week', interval_count: 2 },
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv],
      new Set(),
      PERIOD_START,
    );
    expect(result[0].items.data[0].price.recurring?.interval).toBe('week');
    expect(result[0].items.data[0].price.recurring?.interval_count).toBe(2);
  });

  it('defaults to month/1 when no recurring info on any line', () => {
    const inv = makeInvoice({
      subscription: 'sub_no_recurring',
      customer: 'cus_a',
      // no intervalNew, no intervalLegacy — `lines.data` is empty
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv],
      new Set(),
      PERIOD_START,
    );
    expect(result[0].items.data[0].price.recurring?.interval).toBe('month');
    expect(result[0].items.data[0].price.recurring?.interval_count).toBe(1);
  });

  it('uses LATEST invoice for interval derivation (handles mid-stream interval changes)', () => {
    // If a sub changed billing interval (rare; documented V1 limitation),
    // the live Stripe sub object would also show the current interval. We
    // mirror that by using the LATEST invoice's interval.
    const oldInv = makeInvoice({
      subscription: 'sub_changed',
      customer: 'cus_a',
      finalizedAt: PERIOD_START - 30 * 86400,
      intervalLegacy: { interval: 'month', interval_count: 1 },
    });
    const newInv = makeInvoice({
      subscription: 'sub_changed',
      customer: 'cus_a',
      finalizedAt: PERIOD_START + 86400,
      intervalLegacy: { interval: 'year', interval_count: 1 },
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [oldInv, newInv],
      new Set(),
      PERIOD_START,
    );
    expect(result[0].items.data[0].price.recurring?.interval).toBe('year');
  });

  it('skips subs with no customer reference', () => {
    const inv = makeInvoice({
      subscription: 'sub_no_cust',
      finalizedAt: PERIOD_START,
    });
    // Force customer to be null
    (inv as unknown as Record<string, unknown>).customer = null;
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv],
      new Set(),
      PERIOD_START,
    );
    expect(result).toEqual([]);
  });

  it('passes string customer reference through unchanged', () => {
    const inv = makeInvoice({
      subscription: 'sub_x',
      customer: 'cus_str',
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv],
      new Set(),
      PERIOD_START,
    );
    expect(result[0].customer).toBe('cus_str');
  });

  it('normalizes expanded customer object to { id }', () => {
    // Defensive: if a future fetcher expands `data.customer`, the invoice
    // carries a full Customer object. We pluck the id to match the
    // primitive's expected shape.
    const inv = makeInvoice({
      subscription: 'sub_y',
      customer: { id: 'cus_obj' },
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [inv],
      new Set(),
      PERIOD_START,
    );
    expect(result[0].customer).toEqual({ id: 'cus_obj' });
  });

  it('handles a mix of subscription_create + cycle invoices for different subs', () => {
    // Realistic shape: in a busy month some invoices are first-time creates,
    // most are recurring cycles. Synthesis should set start_date correctly
    // per-sub.
    const newSubCreate = makeInvoice({
      subscription: 'sub_new',
      customer: 'cus_new',
      finalizedAt: PERIOD_START + 86400,
      billingReason: 'subscription_create',
    });
    const oldSubCycle = makeInvoice({
      subscription: 'sub_old',
      customer: 'cus_old',
      finalizedAt: PERIOD_START + 86400,
      billingReason: 'subscription_cycle',
    });
    const result = synthesizeActiveSubscriptionsFromInvoices(
      [newSubCreate, oldSubCycle],
      new Set(),
      PERIOD_START,
    );
    const byId = new Map(result.map((s) => [s.id, s]));
    expect(byId.get('sub_new')?.start_date).toBe(PERIOD_START + 86400);
    expect(byId.get('sub_old')?.start_date).toBe(PERIOD_START - 365 * 86400);
  });
});
