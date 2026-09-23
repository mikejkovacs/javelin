// FilterSpec — structured output from /api/plan (Claude #1, the query planner).
// Source of truth for the Zod schema is javelin-backend/app/api/plan/route.ts.
// This interface mirrors that schema as plain TypeScript. Keep in sync manually.

export type StripeResource =
  | 'customers'
  | 'subscriptions'
  | 'invoices'
  | 'products'
  | 'charges'
  | 'payment_intents'
  | 'balance'
  | 'payouts'
  | 'connected_accounts'
  | 'application_fees'
  | 'transfers'
  | 'disputes'
  | 'reviews'
  | 'tax'
  | 'user_email'
  | 'usage_records'
  | 'meter_events'
  | 'payment_methods'
  | 'coupons'
  | 'promotion_codes';

export interface FilterSpec {
  resources: StripeResource[];
  // Empty array = non-Stripe or conversational question (greeting, pleasantry, meta-question).
  // The executor skips all Stripe fetches and routes directly to Claude #2 with an empty
  // data payload. Claude #2 responds conversationally.
  serverSide: {
    dateRange?: { start: number; end: number }; // unix seconds
    dateField?: string; // explicit user override only — 'created', 'paid_at', 'canceled_at'
                        // When absent, executor applies per-resource defaults:
                        //   invoices      → paid_at
                        //   charges       → created  (item 15)
                        //   subscriptions → created
                        //   canceled subs → canceled_at
    status?: string;    // resource-specific status; validated by executor per resource
                        // e.g. 'paid'/'open'/'uncollectible' for invoices
                        //      'active'/'canceled' for subscriptions
  };
  clientSide: Record<string, never>; // reserved for post-fetch filtering (item 15)
}
