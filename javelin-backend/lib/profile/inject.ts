// Profile injection — builds a human-readable prompt fragment from a Profile
// and exposes the system-prompt rules that teach the interpreter how to use
// (and not misuse) it.
//
// Per P1-S3 refinement: this module owns the high-iteration surfaces:
//   1. Formatting — cents → dollars, ISO codes → human-readable, share → percent
//   2. Classification thresholds — MRR-size bucket names, business-shape naming
//
// The builder emits raw values; `injectProfile` shapes them for prose.

import type {
  Profile,
  Layer1,
  Layer2,
  MixRow,
  MonthlyAmount,
  Distribution,
} from './types';

// ── Formatting helpers ──────────────────────────────────────────────────────

/** Human-readable currency amount. No FX — we show the currency code.
 *  Currency codes: uppercase for display. */
function formatAmount(amount: number, currency: string): string {
  const display = currency.toUpperCase();
  // Two decimals for zero-decimal currencies would be misleading; builder
  // already passes major units so we use them directly. Formatting is
  // conservative — integer if whole, two decimals otherwise.
  const rounded = Math.round(amount * 100) / 100;
  const formatted = Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${display} ${formatted}`;
}

/** Share (0..1) → rounded percent string. */
function formatShare(share: number): string {
  const pct = Math.round(share * 100);
  return `${pct}%`;
}

/** Order-of-magnitude MRR bucket for tone calibration.
 *  Thresholds in USD-equivalent; we don't FX, we just apply numerically in
 *  whatever the profile's MRR currency is. Good enough for grounding. */
function mrrBucket(amount: number): string {
  if (amount < 500) return 'early stage';
  if (amount < 5000) return 'small';
  if (amount < 50000) return 'mid-sized';
  if (amount < 500000) return 'established';
  return 'large';
}

/** Distribution summary — "US 75%, CA 20%, GB 5%" style. */
function formatMix(rows: MixRow[]): string {
  return rows.map((r) => `${r.key.toUpperCase()} ${formatShare(r.share)}`).join(', ');
}

/** Single amount for a series row — integer if whole, else 2 decimals. No
 *  currency prefix (currency is stated once at the line level). */
function formatSeriesAmount(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compact month-amount listing: "2025-05 1,234; 2025-06 1,500; …". */
function formatSeries(series: MonthlyAmount[]): string {
  return series.map((r) => `${r.month} ${formatSeriesAmount(r.amount)}`).join('; ');
}

/** Count median/min/max — 1 decimal if non-integer, integer otherwise. */
function formatCount(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}

/** Distribution line: "typically X (range Y–Z) over the last N months". */
function formatDistribution(d: Distribution): string {
  return `typically ${formatCount(d.median)} (range ${formatCount(d.min)}–${formatCount(d.max)}) over the last ${d.n_months} months`;
}

/** Business-shape vocabulary — natural phrasing in prose. */
function formatBusinessShape(shapes: Layer1['business_shape']): string {
  if (!shapes || shapes.length === 0) return '';
  const parts: string[] = [];
  if (shapes.includes('subscription')) parts.push('subscription');
  if (shapes.includes('one_time')) parts.push('one-time payment');
  if (shapes.includes('connect')) parts.push('Connect platform');
  if (parts.length === 1) return `${parts[0]} business`;
  if (parts.length === 2) return `${parts.join(' + ')} business`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]} business`;
}

// ── Injection ───────────────────────────────────────────────────────────────

/** Assemble the prose prompt fragment from a profile. Returns empty string
 *  if profile is null or has no L1 envelope (cold window / build failure path).
 *  L2 rendering lands in Task 3 — currently this function only reads L1. */
export function injectProfile(profile: Profile | null): string {
  if (!profile || !profile.layer1) return '';
  const l1 = profile.layer1;

  const lines: string[] = [];
  lines.push('MERCHANT PROFILE (background context about this business):');

  if (l1.business_shape && l1.business_shape.length > 0) {
    lines.push(`- Business type: ${formatBusinessShape(l1.business_shape)}.`);
  }

  if (l1.scale) {
    const s = l1.scale;
    const scaleParts: string[] = [];
    if (s.mrr_amount != null && s.mrr_currency) {
      const bucket = mrrBucket(s.mrr_amount);
      const subCount = s.active_subscription_count;
      const subClause =
        subCount != null
          ? ` across ${subCount.toLocaleString('en-US')} active subscription${subCount === 1 ? '' : 's'}`
          : '';
      scaleParts.push(
        `${bucket} by MRR (currently ${formatAmount(s.mrr_amount, s.mrr_currency)}${subClause})`
      );
    }
    if (s.customer_count != null) {
      scaleParts.push(`${s.customer_count.toLocaleString('en-US')} customers`);
    }
    if (s.annual_revenue_amount != null && s.annual_revenue_currency) {
      // Be unambiguous: this is INVOICED revenue (subtotal, post-discount,
      // pre-tax) per Stripe's RevRec definition. Direct charges are excluded.
      // For merchants whose volume is mostly direct charges, this number can
      // be much smaller than gross volume — labeling matters.
      scaleParts.push(
        `${formatAmount(s.annual_revenue_amount, s.annual_revenue_currency)} trailing 12-month invoiced revenue (subtotal, post-discount, pre-tax — excludes direct charges)`
      );
    }
    if (scaleParts.length > 0) {
      lines.push(`- Scale: ${scaleParts.join('; ')}.`);
    }
  }

  if (l1.catalog && l1.catalog.length > 0) {
    const planNames = l1.catalog.map((p) => `"${p.name}"`).join(', ');
    lines.push(
      `- Catalog (refer to plans by these exact names when relevant): ${planNames}.`
    );
  }

  if (l1.geography_mix && l1.geography_mix.length > 0) {
    lines.push(`- Geography mix by card country: ${formatMix(l1.geography_mix)}.`);
  }

  if (l1.payment_method_mix && l1.payment_method_mix.length > 0) {
    lines.push(`- Payment method mix: ${formatMix(l1.payment_method_mix)}.`);
  }

  if (l1.currency_mix && l1.currency_mix.length > 0) {
    lines.push(`- Currency mix: ${formatMix(l1.currency_mix)}.`);
  }

  if (l1.first_charge_date) {
    lines.push(`- First charge processed: ${l1.first_charge_date}.`);
  }

  // ── Layer 2 — pattern facts ──────────────────────────────────────────────
  // Each field renders only when present (omit-when-empty per P1-S8). Series
  // are listed compactly with currency stated once; distributions use a
  // typical-and-range framing so the interpreter can hedge on normalcy.
  const l2 = profile.layer2;
  if (l2) {
    if (l2.monthly_billed_revenue_series && l2.monthly_billed_revenue_series.length > 0) {
      const cur = l2.monthly_billed_revenue_series[0].currency.toUpperCase();
      lines.push(
        `- Monthly billed revenue (${cur}, last 12 months, post-discount, pre-tax): ${formatSeries(l2.monthly_billed_revenue_series)}.`
      );
    }

    if (l2.monthly_recurring_billed_series && l2.monthly_recurring_billed_series.length > 0) {
      const cur = l2.monthly_recurring_billed_series[0].currency.toUpperCase();
      lines.push(
        `- Monthly billed recurring revenue (${cur}, last 12 months — sum of recurring invoice line items, binned by invoice month; yearly billings appear as spikes in the month they were billed): ${formatSeries(l2.monthly_recurring_billed_series)}.`
      );
    }

    if (l2.monthly_collected_charges_series && l2.monthly_collected_charges_series.length > 0) {
      const cur = l2.monthly_collected_charges_series[0].currency.toUpperCase();
      lines.push(
        `- Monthly direct-charge revenue (${cur}, last 12 months — succeeded charges that did not pay an invoice): ${formatSeries(l2.monthly_collected_charges_series)}.`
      );
    }

    if (l2.top_customer_concentration) {
      const c = l2.top_customer_concentration;
      const cur = c.currency.toUpperCase();
      lines.push(
        `- Customer concentration (${cur}, trailing 12 months): top customer ${formatShare(c.top_1_share)}, top 5 ${formatShare(c.top_5_share)}, top 10 ${formatShare(c.top_10_share)}.`
      );
    }

    if (l2.churn_distribution) {
      lines.push(
        `- Monthly subscription cancellations: ${formatDistribution(l2.churn_distribution)}.`
      );
    }

    if (l2.failed_payment_distribution) {
      lines.push(
        `- Monthly failed payments (uncollectible invoices): ${formatDistribution(l2.failed_payment_distribution)}.`
      );
    }

    if (l2.new_customer_distribution) {
      lines.push(
        `- Monthly new customers: ${formatDistribution(l2.new_customer_distribution)}.`
      );
    }

    if (l2.avg_subscription_lifetime_days != null) {
      const days = Math.round(l2.avg_subscription_lifetime_days);
      lines.push(
        `- Average subscription lifetime: ${days.toLocaleString('en-US')} days, based on subscriptions canceled in the last 12 months.`
      );
    }
  }

  // If the profile had nothing to say (all fields absent), don't emit the header.
  if (lines.length === 1) return '';

  return lines.join('\n');
}

// ── System-prompt rules ─────────────────────────────────────────────────────
//
// These rules are concatenated into the interpreter system prompt in
// route.ts. They teach the interpreter how the profile block is used and how
// it MUST NOT be used (P1-S5: profile is context, not ground truth).

export const PROFILE_INJECTION_PROMPT_RULES = `
PROFILE USAGE — CONTEXT ONLY, NEVER THE ANSWER
A "MERCHANT PROFILE" block may appear in the user message. It is slow-moving background context about this merchant's business — typical scale, catalog plan names, geography mix, account age. Use it to calibrate tone, vocabulary, and framing. Use plan names from the catalog verbatim when discussing plans.

The profile is NEVER the source of a number in your answer. Every figure you state must come from the fresh Stripe data + metrics you received on THIS request. If the profile and the current request's data disagree, the current request wins — profile facts are a cache and can be stale by up to seven days. Do not quote profile numbers as if they were current ("Your MRR is $X" — only from current metrics, never from the profile's scale.mrr_amount). Do not repeat profile facts back at the user unsolicited.

REVENUE VOCABULARY — DISAMBIGUATE PROACTIVELY
"Revenue" means different things depending on how a merchant bills:
  - "Billed revenue" / "invoiced revenue" = sum of invoice subtotals (paid + open + uncollectible), post-discount, pre-tax. Stripe's revenue-recognition figure. Excludes direct charges that bypass invoicing.
  - "Gross volume" = total captured across all successful payments, including direct charges. What the Stripe Dashboard home view shows.
For direct-charge-heavy merchants, invoiced revenue can be a small fraction of gross volume — that is correct, not a bug. When you state a revenue figure, name which one. If the user asks generically about "revenue" and the two would diverge meaningfully, note the distinction in one sentence.

DISTRIBUTION-AWARE NORMALCY (LAYER 2 PATTERN FACTS)
When the profile includes a distribution-style fact (monthly subscription cancellations, monthly failed payments, monthly new customers — anything phrased as "typically X (range Y–Z) over the last N months"), and the user asks whether a current observation is normal or surprising, quote the RANGE, not the typical. "Is 5% churn high?" → ground the answer in the range from the profile and where the current observation falls, not in the median alone. Collapsing a range to a point estimate hides volatility — a merchant whose monthly cancellations range 0–8 with median 3 should hear "still in your normal range" for 5, not "above your typical 3." If the current observation falls outside the range, say so explicitly ("higher than any of the last 6 months").

L2 TIME WINDOWS — NEVER COLLAPSE TO "LIFETIME" OR "ALL-TIME"
Every Layer 2 fact in the profile is over a specific trailing window: 12 months for the monthly revenue series and customer concentration, 6 months for the distribution fields. When you cite any L2 fact in an answer, name the window explicitly — "over the last 12 months," "in the trailing 6 months," "across the past year." Forbidden framings: "lifetime," "all-time," "total," "ever," "since launch" — these imply windows the data does NOT cover. Customer concentration in particular reads as a lifetime concept in everyday business voice; in this profile it is strictly trailing 12 months. If a user explicitly asks about lifetime concentration or all-time revenue, say plainly that the profile only carries trailing 12 months and offer to estimate further with a fresh data pull.

REVENUE-SERIES INTERPRETATION
The profile may include up to three monthly revenue series for the trailing 12 months: billed revenue (all invoice subtotals), billed recurring revenue (recurring portion of invoices, binned by invoice month — yearly billings appear as spikes), and direct-charge revenue (succeeded charges that did NOT pay an invoice). Use whichever is non-empty as the trajectory signal. For subscription businesses the recurring series dominates; for direct-charge businesses (Checkout / Terminal / API charges with no invoice) the direct-charge series dominates; hybrids see both. When asked "how's growth?" or "are we growing?", anchor in whichever series is populated and acknowledge if a series is spiky (yearly billings).
`.trim();
