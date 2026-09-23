// Per-merchant business profile — Item 23.
//
// v4 introduces per-layer envelopes (Profile.layer1, Profile.layer2) replacing
// the flat shape from v3. This separation lets L1 and L2 build, persist,
// staleness-check, and fail independently. On L2 build failure, L1 persists
// alone alongside an internal `l2_build_error` marker; staleness rules differ
// (L1 7d, L2 30d).
//
// Bumped 1 → 2 (2026-04-23): catalog plan_name was empty for prices without a
// nickname because the metric layer can't expand product names inline (Stripe
// expand depth cap). v2 builders join product names from a separate fetch.
//
// Bumped 2 → 3 (2026-04-23): dropped account_age_days. account.created in a
// Stripe App reflects authorization time, not actual account creation, so
// the field was structurally wrong for every merchant. first_charge_date is
// the honest "how established is this business" signal.
//
// Bumped 3 → 4 (2026-04-27): per-layer envelope refactor. L2 (Pattern facts)
// adds 7 derived fields; L1 fields move under `profile.layer1`, L2 fields
// under `profile.layer2`. The top-level `builtAt` from v3 moves into each
// layer (`layer1.builtAt`, `layer2.builtAt`) so staleness can be checked
// per-layer. Old v3 caches are discarded on next read; merchants rebuild on
// next sidebar open.
export const PROFILE_SCHEMA_VERSION = 4 as const;

/** Stripe livemode flag — profiles are scoped per mode (P1-S7). */
export type StripeMode = 'live' | 'test';

/** Business shape — derived from presence of subscriptions, charges, Connect. */
export type BusinessShape = 'subscription' | 'one_time' | 'connect';

export interface CatalogPlan {
  name: string;
  monthly_amount: number; // major units, normalized to monthly cadence
  currency: string;       // ISO 4217 lowercase
  active_count: number;
}

export interface MixRow {
  key: string;     // country code, payment method type, or currency code
  share: number;   // 0..1
}

/** Monthly bucket for time-series fields. */
export interface MonthlyAmount {
  month: string;     // ISO 'YYYY-MM'
  amount: number;    // major units, in `currency`
  currency: string;  // ISO 4217 lowercase
}

/** Distribution-aware summary used for churn, failed payments, new customers.
 *  Interpreter quotes the range when answering normalcy questions. */
export interface Distribution {
  min: number;
  median: number;
  max: number;
  /** Sample size — exposed so the interpreter can hedge. */
  n_months: number;
}

/** Top-customer concentration over trailing 12m, in dominant currency. */
export interface TopCustomerConcentration {
  top_1_share: number;   // 0..1
  top_5_share: number;
  top_10_share: number;
  currency: string;      // ISO 4217 lowercase
}

// ── Layer 1 — Stripe facts (refreshed every 7 days) ──────────────────────────

export interface Layer1 {
  /** ISO 8601 timestamp. Staleness check: >7 days. */
  builtAt: string;
  business_shape?: BusinessShape[];
  catalog?: CatalogPlan[];
  scale?: {
    mrr_amount?: number;
    mrr_currency?: string;
    customer_count?: number;
    /** Active subscription count (status='active' or 'past_due', contributing
     *  to MRR). Added M2 Phase 2C-pre as a structural fix for the
     *  count-from-dollar-amount inference failure mode (PCL 2026-05-08).
     *  Surfaces in profile injection alongside MRR. */
    active_subscription_count?: number;
    annual_revenue_amount?: number;
    annual_revenue_currency?: string;
  };
  geography_mix?: MixRow[];
  payment_method_mix?: MixRow[];
  currency_mix?: MixRow[];
  /** Earliest succeeded charge created_at. ISO 8601 date 'YYYY-MM-DD'. */
  first_charge_date?: string;
}

// ── Layer 2 — Pattern facts (refreshed every 30 days) ────────────────────────

export interface Layer2 {
  /** ISO 8601 timestamp. Staleness check: >30 days. */
  builtAt: string;

  /** Trailing 12 months of billed revenue (paid + open + uncollectible
   *  invoices), binned by `created` month, in dominant billed-revenue currency. */
  monthly_billed_revenue_series?: MonthlyAmount[];

  /** Trailing 12 months of billed RECURRING revenue — invoice line items
   *  where `price.recurring` is set, normalized to monthly cadence, in
   *  dominant billed-revenue currency. Close to Stripe's own Billing-report
   *  MRR proxy; explicitly named "billed recurring" because price changes /
   *  discounts / pauses aren't fully reconstructed. */
  monthly_recurring_billed_series?: MonthlyAmount[];

  /** Trailing 12 months of revenue from DIRECT charges — succeeded charges
   *  with no associated invoice (`charge.invoice == null`), binned by
   *  `created` month, in dominant charge currency. Captures merchants who
   *  use Stripe Checkout / Terminal / direct API charges instead of
   *  invoicing. The complement of the billed series — together they cover
   *  invoicing businesses, direct-charge businesses, and hybrids without
   *  double-counting. Interpreter picks whichever has data when answering
   *  "what's revenue been?" */
  monthly_collected_charges_series?: MonthlyAmount[];

  /** Monthly subscription cancellations over trailing 6 months.
   *  Omitted when n_months < 6. */
  churn_distribution?: Distribution;

  /** Monthly uncollectible-invoice counts over trailing 6 months.
   *  Omitted when n_months < 6. */
  failed_payment_distribution?: Distribution;

  /** Monthly new-customer counts (binned by customer.created) over trailing
   *  6 months. Omitted when n_months < 6. */
  new_customer_distribution?: Distribution;

  /** Trailing 12m revenue concentration in top-1/5/10 customers.
   *  Omitted when customer_count < 10 (top_10_share would be 100%). */
  top_customer_concentration?: TopCustomerConcentration;

  /** Mean days from sub creation to cancellation, among subs canceled in
   *  trailing 12m. Omitted when fewer than 6 cancellations. */
  avg_subscription_lifetime_days?: number;
}

// ── Profile envelope ──────────────────────────────────────────────────────────

export interface Profile {
  version: typeof PROFILE_SCHEMA_VERSION;
  mode: StripeMode;
  layer1?: Layer1;
  layer2?: Layer2;
  /** Internal-only — present when L1 succeeded but L2 build failed.
   *  NEVER rendered in prompt or UI. Auto-retry: if `at` is >24h old,
   *  rebuild L2 on next sidebar open regardless of the 30-day clock. */
  l2_build_error?: {
    at: string;
    reason: string;
    /** Consecutive failed L2 builds since last success. Reset to 1 on
     *  first failure after a successful build. */
    attempt_count: number;
  };
}

export interface ProfileStore {
  read(mode: StripeMode): Promise<Profile | null>;
  write(profile: Profile): Promise<void>;
}

// ── Staleness ────────────────────────────────────────────────────────────────

const L1_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const L2_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const L2_ERROR_RETRY_MS = 24 * 60 * 60 * 1000;

/** Whole-profile staleness — true if L1 is missing/stale.
 *  Triggers a full rebuild (both layers, since fetches overlap). */
export function isStale(profile: Profile | null, now: Date = new Date()): boolean {
  if (!profile) return true;
  if (!profile.layer1) return true;
  const builtAtMs = Date.parse(profile.layer1.builtAt);
  if (Number.isNaN(builtAtMs)) return true;
  return now.getTime() - builtAtMs > L1_STALE_MS;
}

/** L2-only staleness check — when L1 is fresh but L2 needs rebuilding.
 *  Three triggers:
 *   1. L2 missing AND no error marker → fresh first-build.
 *   2. L2 missing AND error marker present, error >24h old → auto-retry.
 *   3. L2 present but builtAt > 30 days ago → 30-day clock fired. */
export function isLayer2Stale(profile: Profile, now: Date = new Date()): boolean {
  if (!profile.layer2) {
    if (profile.l2_build_error) {
      const errorAtMs = Date.parse(profile.l2_build_error.at);
      if (Number.isNaN(errorAtMs)) return true;
      return now.getTime() - errorAtMs > L2_ERROR_RETRY_MS;
    }
    return true;
  }
  const builtAtMs = Date.parse(profile.layer2.builtAt);
  if (Number.isNaN(builtAtMs)) return true;
  return now.getTime() - builtAtMs > L2_STALE_MS;
}
