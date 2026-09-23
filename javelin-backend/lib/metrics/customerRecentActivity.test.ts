import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import {
  customerRecentActivity,
  type SubscriptionUpdateEvent,
} from './customerRecentActivity';

const NOW = new Date(Date.UTC(2026, 3, 29, 0, 0, 0));
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const APRIL_2026 = {
  start: Math.floor(Date.UTC(2026, 3, 1, 0, 0, 0) / 1000),
  end: Math.floor(Date.UTC(2026, 3, 30, 23, 59, 59) / 1000),
};

const APR_05 = Math.floor(Date.UTC(2026, 3, 5, 0, 0, 0) / 1000);
const APR_10 = Math.floor(Date.UTC(2026, 3, 10, 0, 0, 0) / 1000);
const APR_22 = Math.floor(Date.UTC(2026, 3, 22, 0, 0, 0) / 1000);
const MAR_15 = Math.floor(Date.UTC(2026, 2, 15, 0, 0, 0) / 1000);
const FEB_15 = Math.floor(Date.UTC(2026, 1, 15, 0, 0, 0) / 1000);

function customer(opts: {
  id?: string;
  name?: string | null;
  email?: string | null;
}): Stripe.Customer {
  return {
    id: opts.id ?? 'cus_x',
    object: 'customer',
    name: opts.name ?? null,
    email: opts.email ?? null,
    phone: null,
    created: 0,
  } as unknown as Stripe.Customer;
}

function charge(opts: {
  id?: string;
  customer: string;
  amount: number;
  amount_refunded?: number;
  refunded?: boolean;
  currency?: string;
  status?: 'succeeded' | 'failed';
  created: number;
}): Stripe.Charge {
  return {
    id: opts.id ?? `ch_${Math.random().toString(36).slice(2, 8)}`,
    customer: opts.customer,
    amount: opts.amount,
    amount_refunded: opts.amount_refunded ?? 0,
    refunded: opts.refunded ?? false,
    currency: opts.currency ?? 'usd',
    status: opts.status ?? 'succeeded',
    created: opts.created,
  } as unknown as Stripe.Charge;
}

function invoice(opts: {
  id?: string;
  status: 'paid' | 'open' | 'void' | 'uncollectible' | 'draft';
  total: number;
  currency?: string;
  finalized_at: number | null;
}): Stripe.Invoice {
  return {
    id: opts.id ?? `in_${Math.random().toString(36).slice(2, 8)}`,
    status: opts.status,
    total: opts.total,
    currency: opts.currency ?? 'usd',
    status_transitions: { finalized_at: opts.finalized_at, paid_at: null, voided_at: null, marked_uncollectible_at: null },
  } as unknown as Stripe.Invoice;
}

function subscription(opts: {
  id?: string;
  status: 'active' | 'canceled' | 'past_due';
  created: number;
  ended_at?: number | null;
}): Stripe.Subscription {
  return {
    id: opts.id ?? `sub_${Math.random().toString(36).slice(2, 8)}`,
    status: opts.status,
    created: opts.created,
    ended_at: opts.ended_at ?? null,
  } as unknown as Stripe.Subscription;
}

function dispute(opts: {
  id?: string;
  charge: string;
  amount: number;
  status: 'lost' | 'won' | 'warning_needs_response';
  currency?: string;
  created: number;
}): Stripe.Dispute {
  return {
    id: opts.id ?? `dp_${Math.random().toString(36).slice(2, 8)}`,
    charge: opts.charge,
    amount: opts.amount,
    status: opts.status,
    currency: opts.currency ?? 'usd',
    created: opts.created,
  } as unknown as Stripe.Dispute;
}

describe('customer_recent_activity', () => {
  it('emits one charge event per succeeded charge in window, sorted desc', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_jr', name: 'Jenny Rosen' }),
      charges: [
        charge({ customer: 'cus_jr', amount: 24500, created: APR_22 }),
        charge({ customer: 'cus_jr', amount: 10000, created: APR_05 }),
      ],
      invoices: [],
      subscriptions: [],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].occurred_at).toBe(APR_22);
    expect(r.rows[0].type).toBe('charge');
    expect(r.rows[0].amount).toBe(245);
    expect(r.rows[0].description).toBe('Paid USD 245.00');
    expect(r.rows[1].occurred_at).toBe(APR_05);
  });

  it('synthesizes a refund event per refunded charge (Q-A: dated at charge.created)', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [
        charge({
          customer: 'cus_x',
          amount: 50000,
          amount_refunded: 10000,
          created: APR_10,
        }),
      ],
      invoices: [],
      subscriptions: [],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.rows).toHaveLength(2);
    const charges_event = r.rows.find((e) => e.type === 'charge');
    const refund_event = r.rows.find((e) => e.type === 'refund');
    expect(charges_event?.amount).toBe(500);
    expect(refund_event?.amount).toBe(-100);
    expect(refund_event?.description).toBe('Refunded USD 100.00');
    expect(refund_event?.status).toBe('partially_refunded');
  });

  it('fully-refunded charge → refund event status is "fully_refunded"', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [
        charge({
          customer: 'cus_x',
          amount: 10000,
          amount_refunded: 10000,
          refunded: true,
          created: APR_10,
        }),
      ],
      invoices: [],
      subscriptions: [],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const refund_event = r.rows.find((e) => e.type === 'refund');
    expect(refund_event?.status).toBe('fully_refunded');
  });

  it('failed charges still surface as a charge event with status="failed"', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [
        charge({ customer: 'cus_x', amount: 25000, status: 'failed', created: APR_10 }),
      ],
      invoices: [],
      subscriptions: [],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].status).toBe('failed');
    expect(r.rows[0].description).toBe('Failed payment of USD 250.00');
  });

  it('invoice events use status_transitions.finalized_at, skip drafts', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [
        invoice({ status: 'paid', total: 100000, finalized_at: APR_10 }),
        invoice({ status: 'draft', total: 50000, finalized_at: null }), // skipped
      ],
      subscriptions: [],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].type).toBe('invoice');
    expect(r.rows[0].status).toBe('paid');
    expect(r.rows[0].amount).toBe(1000);
  });

  it('subscription_created and subscription_canceled events both surface when in window', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [
        subscription({ status: 'canceled', created: APR_05, ended_at: APR_22 }),
      ],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const types = r.rows.map((e) => e.type);
    expect(types).toContain('subscription_created');
    expect(types).toContain('subscription_canceled');
  });

  it('subscription_created OUT of period excluded; canceled IN period included', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [
        subscription({ status: 'canceled', created: FEB_15, ended_at: APR_22 }),
      ],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const types = r.rows.map((e) => e.type);
    expect(types).not.toContain('subscription_created');
    expect(types).toContain('subscription_canceled');
  });

  it('dispute events join to customer via charge.id', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [
        charge({ id: 'ch_target', customer: 'cus_x', amount: 50000, created: APR_05 }),
      ],
      invoices: [],
      subscriptions: [],
      disputes: [
        dispute({ charge: 'ch_target', amount: 50000, status: 'lost', created: APR_22 }),
        // Dispute on a charge NOT in this customer's set — excluded
        dispute({ charge: 'ch_other', amount: 30000, status: 'lost', created: APR_22 }),
      ],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    const dispute_events = r.rows.filter((e) => e.type === 'dispute');
    expect(dispute_events).toHaveLength(1);
    expect(dispute_events[0].amount).toBe(-500);
    expect(dispute_events[0].status).toBe('lost');
  });

  it('out-of-period charges/invoices excluded', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [
        charge({ customer: 'cus_x', amount: 10000, created: MAR_15 }), // out
      ],
      invoices: [
        invoice({ status: 'paid', total: 50000, finalized_at: MAR_15 }), // out
      ],
      subscriptions: [],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.rows).toEqual([]);
  });

  it('event_count_by_type rolled up correctly', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [
        charge({ customer: 'cus_x', amount: 10000, created: APR_05 }),
        charge({ customer: 'cus_x', amount: 10000, amount_refunded: 5000, created: APR_10 }),
      ],
      invoices: [
        invoice({ status: 'paid', total: 50000, finalized_at: APR_22 }),
      ],
      subscriptions: [],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.event_count_by_type).toEqual({
      charge: 2,
      refund: 1,
      invoice: 1,
    });
  });

  it('customer_display_name follows name → email → fallback', () => {
    const named = customerRecentActivity({
      customer: customer({ name: 'Jenny Rosen' }),
      charges: [], invoices: [], subscriptions: [], disputes: [],
      period: APRIL_2026, now: NOW, truncated: false,
    });
    expect(named.customer_display_name).toBe('Jenny Rosen');

    const email_only = customerRecentActivity({
      customer: customer({ name: null, email: 'a@b.com' }),
      charges: [], invoices: [], subscriptions: [], disputes: [],
      period: APRIL_2026, now: NOW, truncated: false,
    });
    expect(email_only.customer_display_name).toBe('a@b.com');

    const neither = customerRecentActivity({
      customer: customer({ name: null, email: null }),
      charges: [], invoices: [], subscriptions: [], disputes: [],
      period: APRIL_2026, now: NOW, truncated: false,
    });
    expect(neither.customer_display_name).toBe('an unnamed customer');
  });

  it('truncated flag passes through; definition + as_of populated', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [], invoices: [], subscriptions: [], disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: true,
    });
    expect(r.truncated).toBe(true);
    expect(r.definition).toBe('javelin_defined.customer_recent_activity');
    expect(r.as_of).toBe(NOW_SEC);
  });
});

// ── Phase 2A — subscription_item_change events + upcoming_cancellations ─────

function subUpdateEvent(opts: {
  id?: string;
  created: number;
  subscriptionId?: string;
  newPriceId: string;
  newPlanName?: string | null;
  oldPriceId: string;
}): SubscriptionUpdateEvent {
  return {
    id: opts.id ?? `evt_${Math.random().toString(36).slice(2, 8)}`,
    created: opts.created,
    subscription: {
      id: opts.subscriptionId ?? 'sub_x',
      items: {
        data: [
          {
            price: {
              id: opts.newPriceId,
              nickname: opts.newPlanName ?? null,
              product: opts.newPlanName ? null : { name: 'Pro' },
            },
          },
        ],
      },
    },
    previous_attributes: {
      items: {
        data: [{ price: { id: opts.oldPriceId } }],
      },
    },
  };
}

describe('customer_recent_activity — subscription_item_change events', () => {
  it('emits an event when items array changed price IDs', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [],
      disputes: [],
      subscriptionUpdateEvents: [
        subUpdateEvent({
          created: APR_22,
          oldPriceId: 'price_starter',
          newPriceId: 'price_pro',
          newPlanName: 'Pro',
        }),
      ],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].type).toBe('subscription_item_change');
    expect(r.rows[0].description).toBe('Plan changed to Pro');
    expect(r.rows[0].occurred_at).toBe(APR_22);
  });

  it('falls back to neutral description when plan name unresolvable', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [],
      disputes: [],
      subscriptionUpdateEvents: [
        {
          id: 'evt_1',
          created: APR_22,
          subscription: { id: 'sub_x', items: null },
          previous_attributes: {
            items: { data: [{ price: { id: 'price_old' } }] },
          },
        },
      ],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    // No items in current snapshot → priceIdsChanged returns true (old price
    // not found in empty current set), description falls back.
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].description).toBe('Subscription plan changed');
  });

  it('skips events outside the period window', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [],
      disputes: [],
      subscriptionUpdateEvents: [
        subUpdateEvent({
          created: FEB_15, // before APRIL_2026
          oldPriceId: 'price_a',
          newPriceId: 'price_b',
        }),
      ],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.rows).toEqual([]);
  });

  it('skips updates whose items did NOT change price IDs (e.g. quantity-only)', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [],
      disputes: [],
      subscriptionUpdateEvents: [
        {
          id: 'evt_qty',
          created: APR_22,
          subscription: {
            id: 'sub_x',
            items: { data: [{ price: { id: 'price_pro' } }] },
          },
          previous_attributes: {
            items: { data: [{ price: { id: 'price_pro' } }] },
          },
        },
      ],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.rows).toEqual([]);
  });

  it('handles missing subscriptionUpdateEvents (default empty)', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.rows).toEqual([]);
    expect(r.subscription_history_window_days).toBe(30);
  });
});

describe('customer_recent_activity — upcoming_cancellations', () => {
  function subWithCancel(opts: {
    id?: string;
    cancel_at_period_end: boolean;
    cancel_at: number | null;
    status?: 'active' | 'canceled' | 'past_due' | 'trialing';
    plan_nickname?: string | null;
    product_name?: string | null;
  }): Stripe.Subscription {
    return {
      id: opts.id ?? 'sub_pending',
      status: opts.status ?? 'active',
      created: APR_05,
      ended_at: null,
      cancel_at_period_end: opts.cancel_at_period_end,
      cancel_at: opts.cancel_at,
      items: {
        data: [
          {
            price: {
              id: 'price_x',
              nickname: opts.plan_nickname ?? null,
              product:
                opts.product_name === undefined
                  ? null
                  : opts.product_name === null
                    ? null
                    : { name: opts.product_name },
            },
          },
        ],
      },
    } as unknown as Stripe.Subscription;
  }

  it('emits an entry when cancel_at_period_end is true on an active sub', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [
        subWithCancel({
          cancel_at_period_end: true,
          cancel_at: APR_22,
          plan_nickname: 'Pro',
        }),
      ],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.upcoming_cancellations).toHaveLength(1);
    expect(r.upcoming_cancellations[0].plan_name).toBe('Pro');
    expect(r.upcoming_cancellations[0].cancels_at).toBe(APR_22);
  });

  it('falls back to product.name when nickname null', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [
        subWithCancel({
          cancel_at_period_end: true,
          cancel_at: APR_22,
          plan_nickname: null,
          product_name: 'Enterprise',
        }),
      ],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.upcoming_cancellations[0].plan_name).toBe('Enterprise');
  });

  it('does NOT emit when cancel_at_period_end is false', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [
        subWithCancel({ cancel_at_period_end: false, cancel_at: null }),
      ],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.upcoming_cancellations).toEqual([]);
  });

  it('does NOT emit for already-canceled subs', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [
        subWithCancel({
          cancel_at_period_end: true,
          cancel_at: APR_22,
          status: 'canceled',
        }),
      ],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.upcoming_cancellations).toEqual([]);
  });

  it('empty upcoming_cancellations when no subs', () => {
    const r = customerRecentActivity({
      customer: customer({ id: 'cus_x' }),
      charges: [],
      invoices: [],
      subscriptions: [],
      disputes: [],
      period: APRIL_2026,
      now: NOW,
      truncated: false,
    });
    expect(r.upcoming_cancellations).toEqual([]);
  });
});
