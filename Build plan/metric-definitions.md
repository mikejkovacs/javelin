# Javelin Metric Definitions

**Status:** Draft, ratified 2026-04-22.
**Owner doc for:** every metric Javelin computes deterministically (item 5b and downstream).
**Companion to:** `javelin-v2-spec.md`. This doc resolves ambiguities the spec defers to "definition-time."

---

## Purpose

This is the single authoritative source for how every Javelin metric is defined. Implementation (5b primitives), interpretation (Claude #2 prompt rules), and V3 tool-call grounding all reference this doc. Any new metric or change to an existing definition is a doc edit *first*, then a code change.

Stripe is the source of truth. Where Stripe publishes a definition, we match it verbatim. Where Stripe's sources disagree, this doc names the chosen source. Where Stripe has no canonical definition, the metric is either explicitly Javelin-defined (with rationale) or cut from the inventory.

## Source hierarchy

When Stripe sources disagree, prefer in this order:

1. **Stripe Sigma schema reference / `subscription_item_change_events`** — query-level, what Stripe's own analytics use
2. **Stripe Billing analytics docs and glossary** (`docs.stripe.com/billing/subscriptions/analytics/glossary`) — product-level
3. **Stripe API reference object docs** (`docs.stripe.com/api/...`) — for field-level provenance
4. **Stripe help center** (`support.stripe.com`) — user-facing, often less precise
5. **Stripe marketing / `stripe.com/resources/*` pages** — least authoritative; treat as industry reference, not Stripe-canonical

A definition sourced from #5 alone is **not** Stripe-canonical for our purposes (this is why NRR / GRR are cut — see below).

**Forward note (2026-04-30) — Revenue Recognition cross-reference:** When extending this doc with new metrics that touch accrual accounting, deferred revenue, GAAP/ASC 606 concepts, or revenue treatment under refunds/disputes/multi-currency/Connect fund flows, also consult Stripe's Revenue Recognition product methodology pages. They publish formal definitions that already inform some entries in this doc (e.g., the billed-revenue-date decision). Treat as supplementary source — does not change the hierarchy above. Index entry point: `docs.stripe.com/llms.txt` → "Revenue Recognition" section. Most relevant pages:
- `docs.stripe.com/revenue-recognition/methodology.md`
- `docs.stripe.com/revenue-recognition/methodology/subscriptions-and-invoicing.md`
- `docs.stripe.com/revenue-recognition/methodology/refunds-and-disputes.md`
- `docs.stripe.com/revenue-recognition/methodology/multi-currency.md`

## Decisions ratified 2026-04-22

| Ambiguity | Decision |
|---|---|
| ARR | `MRR × 12`, flagged as industry-standard derivation; Stripe's billing analytics glossary does not publish an independent ARR definition |
| NRR / GRR | **Cut from 5b.** Stripe defines them only on marketing pages, not in product docs. Defer to V3 / item 23 |
| Churn rate | Match Stripe glossary verbatim: rolling 30-day subscriber churn rate |
| Billed revenue date | `invoice.status_transitions.finalized_at` per Revenue Recognition |
| Collected revenue source | Charges (`amount − amount_refunded`, `status = succeeded`, `created` in period) |
| Net revenue | Ship both `period_net_revenue` (accounting view, fees-separate) and `period_net_cash` (processor-fee-inclusive) |
| MRR discount handling | Always subtract recurring + one-time discounts; matches Stripe's strictest setting. **Future:** match each merchant's Dashboard MRR configuration once item 23 exposes it |
| Time-series bucketing | Calendar month, end-of-day in merchant's Stripe account timezone |
| Multi-currency MRR | Per-currency rows, no FX conversion (matches Stripe's "filtering/grouping isn't available across currencies" posture) |
| Normalization multipliers | annual / 12, quarterly / 3, weekly × (52/12), daily × (365/12); validated by fixture against Dashboard |
| Geography | `payment_method_details.card.country` (card issuing country) — explicit primitive name `revenue_by_card_country`; **future** upgrade path to billing-address-based when populated |
| Pause-collection MRR | Exclude subs with `pause_collection.behavior IN ('void', 'mark_uncollectible')`; include `keep_as_draft` |
| Customer concentration | Javelin-defined: top-1 / top-5 / top-10 share of `period_collected_revenue` |
| Active customer count | Ship both `active_subscription_customer_count` (state, MRR-aligned) and `paying_customer_count` (flow, charge-based) |

---

## Cross-cutting policies

These apply to every metric below unless overridden.

**Timezone.** All date arithmetic uses the merchant's Stripe account timezone (`account.timezone`). Calendar boundaries (start of month, end of quarter, etc.) are end-of-day in that timezone. Documented per metric where it matters.

**Multi-currency.** Metrics that aggregate amounts return per-currency rows (`Array<{ currency, value }>`). No FX conversion in 5b. Single-currency merchants get a one-element array.

**Currency units.** All monetary values returned by metric functions are in **dollars** (or major currency units), not cents. Conversion from cents happens inside the metric function. Interpreter never sees cents.

**Filter input shape.** Every metric accepts a `MetricInput` subset of:

```
{
  dateRange?: { start: number; end: number },  // unix seconds
  currency?: string,
  status?: string,                              // resource-specific
  customerIds?: string[],
  productIds?: string[],
  cardCountry?: string,                         // ISO 3166-1 alpha-2
}
```

Unknown fields are ignored (forward-compatible). Date fields default per the per-resource defaults already established in `resolveDateExpression.ts`.

**Output envelope.** Every metric returns:

```
{
  value: T,                              // type varies per metric
  unit: 'usd' | 'count' | 'percent' | 'rows',
  currency?: string,
  definition: string,                    // 'stripe_billing_analytics_glossary.mrr', 'javelin_defined.customer_concentration', etc.
  as_of: number,                         // unix seconds
  rows?: Row[],                          // tabular companion if applicable
  error?: 'unsupported' | 'no_data' | 'rate_limited',
}
```

Metrics never throw. Errors are returned in the envelope (Pattern C precedent from the fetcher layer).

**Staleness.** 5b computes everything from a fresh fetch. Caching is item 23. The `as_of` field is present from day one so caching can drop in without changing the contract.

**Discounts in any revenue figure.** Per Stripe's glossary, MRR is post-discount. By default, all monetary metrics are computed post-discount and post-coupon. Tax exclusion follows Revenue Recognition (recognizable portion excludes tax).

---

## Layer A — Row primitives (tabular)

Tabular row primitives are the leverage layer. Most Layer B scalars are aggregations over Layer A. V3 tool calls reach for these directly when answering analytical questions.

### `customer_rollup`

One row per customer, denormalized with the fields needed for concentration, top-N, and segmentation questions.

**Output rows:**

```
{
  customer_id: string,
  name: string | null,
  email: string | null,
  card_country: string | null,           // from most-recent successful charge
  created_at: number,                    // customer.created
  first_charge_at: number | null,
  last_charge_at: number | null,
  lifetime_collected: number,            // sum of net_collected across input succeeded charges
  lifetime_collected_currency: string | null, // dominant (highest-total) currency for the lifetime sum
  current_mrr: number,                   // dollars; sum of contributing-sub MRR in mrr_currency
  mrr_currency: string | null,           // dominant (highest-total) currency for current_mrr
  subscriptions: Array<{                 // all subs for this customer (any state)
    plan_name: string,                   // price.nickname ?? product.name
    status: string,
    monthly_normalized_amount: number,
    started_at: number,
  }>,
  subscription_count: number,
}
```

**M2.3 deviations from earlier draft (ratified 2026-04-22):**
- Replaced scalar `active_plan` + `subscription_status` with the `subscriptions` array. Preserves multi-sub information; concentration / ranking callers continue to use scalar `current_mrr`. Consumers wanting a "primary plan" pick the highest-MRR entry from the array.
- `lifetime_collected` is honest about its inputs — it's the sum of net collected across charges *passed in*. The V2 bundler passes an unbounded charges fetch when planner routes to `customers`. V3 tool wrappers will window per-question.
- Added `mrr_currency` and `lifetime_collected_currency` so multi-currency customers don't silently collapse. Both pick the highest-total currency (M2.3-S2).

**Sources:** Customer object, charge_enriched (joined client-side), subscription_enriched (joined client-side).

**Edge cases:** Deleted customers (`customer.deleted = true`) excluded. Customers with zero charges and no subscriptions still included (they're customers in Stripe's sense).

### `subscription_enriched`

One row per subscription with normalized fields for MRR computation.

**Output rows:**

```
{
  subscription_id: string,
  customer_id: string,
  status: string,                        // active, trialing, past_due, canceled, etc.
  monthly_normalized_amount: number,     // dollars, post-discount, pre-tax; 0 if MRR-excluded
  raw_amount: number,                    // dollars, pre-normalization
  currency: string,
  interval: 'day' | 'week' | 'month' | 'year',
  interval_count: number,
  plan_name: string,                     // price.nickname ?? product.name
  product_id: string,
  price_id: string,
  started_at: number,                    // subscription.start_date
  canceled_at: number | null,
  ended_at: number | null,
  cancellation_reason: string | null,
  pause_collection_behavior: 'void' | 'mark_uncollectible' | 'keep_as_draft' | null,
  contributes_to_mrr: boolean,           // true iff status IN ('active','past_due') AND not trial AND not pause-voided/uncollectible
}
```

**Normalization formula:**
- `monthly_normalized_amount = (raw_amount / interval_count) × multiplier`
- Multipliers: `year → 1/12`, `month → 1`, `week → 52/12`, `day → 365/12`

**Sources:** [Subscription object](https://docs.stripe.com/api/subscriptions/object), [Billing analytics glossary](https://docs.stripe.com/billing/subscriptions/analytics/glossary).

### `charge_enriched`

One row per charge with derived columns for segmentation.

**Output rows:**

```
{
  charge_id: string,
  customer_id: string | null,
  amount: number,                        // dollars, gross
  amount_refunded: number,               // dollars
  net_collected: number,                 // amount - amount_refunded
  currency: string,
  status: 'succeeded' | 'pending' | 'failed',
  created_at: number,
  card_brand: string | null,             // payment_method_details.card.brand
  card_country: string | null,           // payment_method_details.card.country
  billing_country: string | null,        // billing_details.address.country (often null — see future note)
  disputed: boolean,
  refunded: boolean,
  fee: number | null,                    // from balance_transaction.fee if expanded; otherwise null
  net: number | null,                    // from balance_transaction.net if expanded; otherwise null
}
```

**Sources:** [Charge object](https://docs.stripe.com/api/charges/object).

### `invoice_enriched`

One row per invoice with derived "billed" amount.

**Output rows:**

```
{
  invoice_id: string,
  customer_id: string | null,
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void',
  total: number,                         // dollars, post-discount + tax
  subtotal: number,                      // dollars, post-discount, pre-tax
  tax: number,                           // dollars
  amount_paid: number,                   // dollars
  amount_due: number,                    // dollars
  amount_remaining: number,              // dollars
  currency: string,
  created_at: number,
  finalized_at: number | null,           // status_transitions.finalized_at — canonical "billed on" per RevRec
  paid_at: number | null,                // status_transitions.paid_at
  voided_at: number | null,
  marked_uncollectible_at: number | null,
  product_ids: string[],                 // from line items
  price_ids: string[],
}
```

**Billed amount convention.** Default `billed_amount = subtotal` (pre-tax, post-discount, matching Revenue Recognition's recognizable portion). Consumers needing tax-inclusive use `total` explicitly.

**Sources:** [Invoice object](https://docs.stripe.com/api/invoices/object), [Revenue Recognition methodology](https://docs.stripe.com/revenue-recognition/methodology).

---

## Layer B — Named metrics

### Scalars

#### `mrr`

> "The sum of the monthly-normalized value of all your `active` and `past_due` subscriptions."

Excludes: trialing subscriptions, taxes, free plans, metered/usage-based products. Canceled and `unpaid` excluded (they're churn). Subs with `pause_collection.behavior IN ('void', 'mark_uncollectible')` excluded; `keep_as_draft` included.

Recurring + one-time discounts subtracted (Javelin currently always-strictest; future per-merchant configuration is a deferred decision — see below).

**Computation.** Sum `subscription_enriched.monthly_normalized_amount where contributes_to_mrr = true`, grouped by `currency`.

**Output.**

```
{
  value: Array<{ currency: string, mrr: number, subscription_count: number }>,
  unit: 'usd',
  definition: 'stripe_billing_analytics_glossary.mrr',
  as_of: number,
}
```

**Source:** [Billing analytics glossary](https://docs.stripe.com/billing/subscriptions/analytics/glossary).

#### `arr`

`arr = mrr × 12`. Per-currency. **Definition source:** `javelin_derived.arr` — Stripe's billing analytics glossary does not publish an independent ARR definition.

#### `active_subscription_count`

Count of subscriptions where `contributes_to_mrr = true`. Same inclusion rule as MRR for consistency.

**Source:** [Billing analytics glossary](https://docs.stripe.com/billing/subscriptions/analytics/glossary) — Stripe's "Active Subscribers" definition is at the *subscriber* level (see below); this is the *subscription-level* count, derived using the same status-inclusion rule.

#### `active_subscription_customer_count`

> "Subscribers with positive MRR that are in an `active` or `past_due` status. Doesn't include subscribers on free plans or trials."

Distinct `customer_id` count from `subscription_enriched where contributes_to_mrr = true`. A customer with multiple active subs counts once.

**Output.** `{ value: number, unit: 'count', definition: 'stripe_billing_analytics_glossary.active_subscribers', ... }`

**Source:** [Billing analytics glossary](https://docs.stripe.com/billing/subscriptions/analytics/glossary).

#### `paying_customer_count`

Distinct `customer_id` count from `charge_enriched where status = 'succeeded' AND created_at IN dateRange`.

This is the cash-flow companion to `active_subscription_customer_count`. Different question, different answer:

- `active_subscription_customer_count` — "who is currently subscribed" (state)
- `paying_customer_count` — "who paid me in this period" (flow)

For a one-time-payment business (Withairsync shape), `active_subscription_customer_count = 0` always; only this metric is meaningful. For an annual-plan SaaS asking about a single month, this metric undercounts — only `active_subscription_customer_count` reflects the customer base.

**Definition:** `javelin_defined.paying_customer_count`.

#### `period_billed_revenue`

Sum of `invoice_enriched.subtotal` (default — pre-tax, post-discount per Revenue Recognition's recognizable portion) where `status IN ('paid', 'open', 'uncollectible')` AND `finalized_at IN dateRange`.

Per-currency.

Optional sibling: `period_billed_revenue_inclusive_of_tax` using `total` instead of `subtotal`.

**Date field:** `finalized_at` per RevRec methodology — the "billed on" event.

**Excludes:** voided invoices (`status = 'void'`).

**Source:** [Revenue Recognition methodology](https://docs.stripe.com/revenue-recognition/methodology).

#### `period_collected_revenue`

Sum of `(charge.amount − charge.amount_refunded)` where `status = 'succeeded'` AND `created IN dateRange`. Per-currency.

This is gross collected, refund-adjusted. Stripe fees not subtracted (see `period_net_cash` for that).

**Definition:** `javelin_derived.period_collected_revenue` — Stripe does not publish a single "collected revenue" metric; this matches the Stripe Payments dashboard's gross volume after refunds.

**Source:** [Charge object](https://docs.stripe.com/api/charges/object).

#### `period_net_revenue`

Accounting net: `gross_collected − refunds − chargebacks`. Stripe fees **not** subtracted (they're an operating expense, not a revenue contra).

`= sum(charge.amount where status = 'succeeded') − sum(charge.amount_refunded) − sum(dispute.amount where status IN ('lost','warning_closed'))` over `created IN dateRange`. Per-currency.

**Definition:** `javelin_defined.period_net_revenue` — Stripe's Revenue Recognition product does not define "net revenue" explicitly; this is the standard accounting net.

#### `period_net_cash`

Sum of `balance_transaction.net` for transaction types `charge`, `refund`, `adjustment`, `payment_refund`, `dispute` where `created IN dateRange`. Per-currency.

This is "what hit the bank" — gross minus Stripe fees minus refunds minus chargebacks. The processor-fee-inclusive view.

**Definition:** `stripe_balance_transaction.net_aggregation` — direct sum of the canonical `balance_transaction.net` field.

**Source:** [BalanceTransaction object](https://docs.stripe.com/api/balance_transactions/object).

**Note:** `period_net_revenue` and `period_net_cash` are different numbers. Both are correct answers to different questions. Naming kept distinct so the interpreter cannot conflate them — directly addresses the cents↔dollars / net-revenue confabulation bugs from items 18–19.

#### `churn_count`

Count of subscriptions where `ended_at IN dateRange` (subscription stopped generating MRR within the period). Split into voluntary vs. involuntary by `cancellation_details.reason`:

- Voluntary: `cancellation_requested`, `canceled_by_retention_policy`
- Involuntary: `payment_failed`
- Other: `payment_disputed` (typically dispute-driven; surfaced separately in narrative)
- Unknown: `cancellation_details.reason` is null

**Output.**

```
{
  value: { total: number, voluntary: number, involuntary: number, other: number, unknown: number },
  unit: 'count',
  definition: 'stripe_subscription.cancellation_details',
  as_of: number,
}
```

**Date field choice:** `ended_at` (when MRR stopped) per Stripe's billing analytics convention. Subscriptions canceled with `cancel_at_period_end = true` are counted in the period when they actually end, not when cancellation was requested.

**Source:** [Subscription object](https://docs.stripe.com/api/subscriptions/object), [Billing analytics glossary](https://docs.stripe.com/billing/subscriptions/analytics/glossary).

#### `churn_rate`

> "The number of total churned subscribers in the past 30 days, divided by the number of active subscribers 30 days ago, plus the total new subscribers in the past 30 days."

Rolling 30-day, subscriber-level. Match Stripe verbatim.

`churned_subscribers_30d / (active_subscribers_30d_ago + new_subscribers_30d)`

**Definition:** `stripe_billing_analytics_glossary.subscriber_churn_rate`.

**Note:** This metric does not accept a `dateRange` input — the 30-day window is fixed per Stripe's definition. To answer "what was my churn rate in March," compose `churn_count` with manual denominator construction; flag the deviation when narrating.

**Source:** [Billing analytics glossary](https://docs.stripe.com/billing/subscriptions/analytics/glossary).

#### `customer_concentration`

Top-N customer share of `period_collected_revenue`.

**Output.**

```
{
  value: {
    top_1_share: number,                 // 0..1
    top_5_share: number,
    top_10_share: number,
    top_1_customer: { id, name, amount } | null,
  },
  unit: 'percent',
  definition: 'javelin_defined.customer_concentration',
  rows: Array<{ rank, customer_id, name, amount, share }>,  // top 10
  currency: string,                      // ranking currency (Stripe account.default_currency)
  total_collected: number,               // denominator (major units, in `currency`)
  period: { start, end },
  as_of: number,
}
```

**M2.3 ratified (2026-04-22 / 2026-04-23):**
- **Single-currency ranking (S4):** The metric ranks within the Stripe account's `default_currency` only. Customers whose period charges are entirely in another currency contribute $0. Documented limitation; revisit at first multi-currency merchant.
- **Top-N is fixed at 10.** Questions like "top 27 customers" are deferred to V3 — the V3 tool wrapper around `customer_rollup` will sort + slice as needed without a separate `top_n` metric.
- **Default period = unbounded (S6, 2026-04-23):** The metric accepts `period` from the caller. When planner provides no dateRange, the V2 bundler passes `{ start: 0, end: now }` — unbounded — so the denominator matches `customer_rollup.lifetime_collected`'s unbounded scope. Matches S1's stance for the fetch. When planner provides a dateRange (e.g. "customer concentration last quarter"), the bundler passes that window verbatim and the denominator is period-scoped as the phrase implies.

**Definition:** Javelin-defined. No Stripe canonical exists.

### Segmentation

All segmentation metrics aggregate `period_collected_revenue` over a dimension. Output shape is consistent: `{ rows: Array<{ key, value, share }>, total }`.

#### `revenue_by_card_country`

Group `charge_enriched.net_collected` by `card_country` (ISO 3166-1 alpha-2, from `payment_method_details.card.country`).

**Important framing:** This is *card issuing country* — where the card was issued, not where the cardholder lives. Interpreter must label as such ("based on card issuing country, your top market is X").

**Coverage:** `card.country` is populated for nearly all card payments. Non-card payment methods (ACH, SEPA, etc.) appear as `country: null`. If null share > 10%, the interpreter should note coverage.

**Future upgrade path:** When billing address coverage improves (Stripe-side or merchant-side), evaluate adding `revenue_by_billing_country` as a sibling using `billing_details.address.country`. Decision deferred.

#### `revenue_by_plan`

Group `period_collected_revenue` by `plan_name` (resolved as `price.nickname ?? product.name`). Subscription revenue only — non-subscription charges grouped as `"unattributed"`.

#### `revenue_by_product`

Group by `product_id` (rolled up from `subscription_enriched.product_id` and `invoice_enriched.product_ids`). Plan-level rollup.

#### `revenue_by_card_brand`

Group by `card_brand` from `charge_enriched.card_brand`. Brands per Stripe's enum: `amex`, `cartes_bancaires`, `diners`, `discover`, `eftpos_au`, `jcb`, `link`, `mastercard`, `unionpay`, `visa`, `unknown`.

**Source:** [Charge object](https://docs.stripe.com/api/charges/object).

### Time series

Bucketing rules apply to all time series:
- **Granularity:** monthly (default), weekly, or daily (input parameter)
- **Bucket boundary:** end-of-day in merchant timezone for state metrics; created-timestamp in merchant timezone for flow metrics
- **Bucket label:** ISO date of the bucket end (e.g., `"2026-04-30"` for April 2026)

**Output.** `{ buckets: Array<{ label, value }>, currency, ... }` per-currency.

#### `mrr_timeseries`

Series of MRR values, one per bucket end-of-period snapshot. State metric — value at end of bucket reflects subscriptions in MRR-inclusion state at that timestamp.

#### `revenue_timeseries`

Two siblings: `billed_revenue_timeseries` and `collected_revenue_timeseries`. Flow metrics — bucket value is sum of activity within the bucket.

#### `customer_count_timeseries`

End-of-bucket count of customers in MRR-inclusion state. State metric.

#### `churn_timeseries`

Bucketed `churn_count` (total / voluntary / involuntary breakdown per bucket). Flow metric.

### Balance (Stripe-canonical)

#### `account_balance`

Snapshot of `/v1/balance` plus a per-date pending-settlement breakdown derived from `/v1/balance_transactions?status=pending` (filtered client-side; Stripe SDK doesn't accept `status` as a list filter).

**Output (per currency arrays):**
- `available[]`: `{ currency, amount }` — "ready for immediate transfer or payout" (Stripe canonical)
- `pending[]`: `{ currency, amount }` — "still processing; not yet spendable" (Stripe canonical)
- `instant_available[]`: `{ currency, amount }` or `null` — Instant-Payouts-eligible subset
- `pending_settlement_breakdown[]`: `{ available_on (ISO date), currency, amount, count }` — pending balance_transactions grouped by Stripe's per-row settlement clock, sorted ascending by date

**Scope (Chunk B / 1D):** `connect_reserved` and `issuing` surfaces are intentionally NOT surfaced — Javelin V2 ICP does not span Connect platforms or Issuing card programs. `source_types` (card / bank_account / fpx) breakdown also dropped — the "why is part of my balance pending" question is answered by `pending_settlement_breakdown` instead.

**Definition tag:** `stripe_canonical.balance_object`. Sources: [Balance object](https://docs.stripe.com/api/balance/balance_object), [BalanceTransaction list](https://docs.stripe.com/api/balance_transactions/list).

#### `balance_explanation`

Stripe's Balance Summary report view of a time window — narrates how the merchant's balance MOVED.

**Input:** `{ start, end }` (ISO YYYY-MM-DD).

**Output (per currency block):**
- `starting_balance` — derived by synthesis: `current_balance − net_activity_in_period + payouts_outflow_in_period` (Stripe doesn't expose historical balance lookup)
- `activity[]`: `{ category, amount, count }` per `reporting_category` (charges/refunds/disputes/adjustments + a synthetic `fee` row), sorted by `|amount|` desc. Amounts are GROSS (mirroring Stripe Dashboard's per-category lines); the synthetic `fee` row aggregates per-row processing fees inlined on charge BTs (Stripe Dashboard breaks fees out separately on the Balance Summary)
- `payouts`: `{ count, total }` — separate per Stripe canonical
- `net_activity` — sum of `activity[].amount` (excludes payouts)
- `ending_balance` — `starting + net_activity − payouts.total`
- Top-level `truncated: bool` — set when fetcher hit the 5K row cap

**Aggregation key:** `reporting_category`, NOT `type` (BalanceTransaction `type` has 41 values; Stripe Dashboard groups via `reporting_category`). Categories outside the canonical set fall through to `'other'`.

**Multi-currency:** per-currency block, no cross-currency summing (CRITICAL RULE #8).

**Definition tag:** `stripe_canonical.balance_summary`. Sources: [Balance summary report](https://docs.stripe.com/reports/balance), [BalanceTransaction list](https://docs.stripe.com/api/balance_transactions/list).

### Customer entity tools (Chunk C / 2B)

#### `customer_lookup`

Find a Stripe customer by name, email, or customer ID and surface enough disambiguation context (recent activity, lifetime collected, display_name fallback) for the LLM to answer "is this the right one" cleanly.

**Input:** at least one of `name`, `email`, `id` (strings).

**Output rows** (per matched customer): `{id, name, email, phone, created, most_recent_charge_at, lifetime_collected, lifetime_currency, display_name}`. Sorted by `most_recent_charge_at` desc (most-recently-active first), with `created` desc as a tiebreaker. `display_name` follows the canonical fallback chain `name → email → 'an unnamed customer'` (mirrors `customer_concentration`).

**Hybrid match strategy** (Q1.2 from Chunk C kickoff): if `id` provided → direct retrieve. If `email` provided → Stripe Search exact-match on `email:'X'`. If `name` provided → Stripe Search exact-match first; on 0 results, fall back to listing customers (cap 1k) and prefix-matching client-side on `customer.name` (handles "Jenn" → "Jenny Rosen", which Stripe Search misses). Result includes `match_strategy` so the LLM can hedge ("I fell back to a prefix search").

**Definition tag:** `javelin_defined.customer_lookup`. Composition is Javelin-defined; underlying lookups are Stripe-canonical (Search API + Retrieve API).

#### `customer_recent_activity`

Chronological activity feed for a single customer — payments (charges), refunds, invoices, subscription state changes, and disputes. Composes data from multiple Stripe endpoints that no single API returns together.

**Input:** `customer_id` (required, `cus_*`) + optional `start`/`end` ISO dates. Default trailing 90 days from now when window omitted.

**Output rows** (per event): `{type, occurred_at, occurred_at_iso, amount, currency, description, status, source_id}`. Sorted desc by `occurred_at`. Event types: `charge`, `refund` (one synthetic event per refunded charge per Q-A), `invoice`, `subscription_created`, `subscription_canceled`, `dispute`. `description` is pre-rendered Stripe-Dashboard-style verb-first ("Paid USD 245.00", "Refunded USD 50.00", "Subscription canceled"). Result includes `event_count_by_type` rollup and `truncated` flag (Q-C).

**Definition tag:** `javelin_defined.customer_recent_activity`. Composition Javelin-defined; underlying event sources Stripe-canonical.

### Comparison helper

#### `compare_periods`

Wrapper that takes any scalar metric + two date ranges and returns the comparison.

**Input:** `{ metric: string, period_a: { start, end }, period_b: { start, end } }`

**Output.**

```
{
  metric: string,
  a: { value, label },
  b: { value, label },
  delta_absolute: number,
  delta_percent: number,
  direction: 'up' | 'down' | 'flat',
}
```

Definition: Javelin-defined helper. No metric-specific semantics.

### Projection family (Chunk D / 6C)

Forward-looking primitives that project a metric forward at the current trajectory or estimate ETA to a target. Three primitives ship together: `project_revenue` (Deploy 1), `project_customer_count` and `goal_eta` (Deploy 2). Narrated under CRITICAL RULE #10 (projection-mode answers — conditional verb tense, mandatory trend-label disclosure, customer-count assumption disclosure).

**Stripe-canonical research (verified 2026-05-01):** Stripe publishes no canonical projection methodology. Sources checked:
- [SaaS Revenue Forecasting](https://stripe.com/resources/more/saas-revenue-forecasting) — marketing/resources page (source-hierarchy tier 5). Describes MRR-buildup and cohort-modeling concepts, no formulas.
- [Billing analytics](https://docs.stripe.com/billing/subscriptions/analytics) — purely retrospective surface. No projected MRR, no goal ETA, no trajectory feature.
- Stripe Sigma — SQL access; no canonical projection schema.

Per source-hierarchy rule, tier-5 marketing alone does not qualify as Stripe-canonical (same reason NRR/GRR were cut). Methodology is therefore Javelin-defined with documented rationale.

#### `project_revenue`

Trend-aware compounding projection of a revenue metric forward N months.

**Method:** call `growth_rate` over the trailing N-month series. Take its `avg_growth_rate` as the per-month rate, `trend_label` as the confidence signal, last-row value as `current_value`. Compound: `projected_value = current_value × (1 + monthly_growth_rate)^horizon_months`.

**Inputs:** `metric` (recurring_revenue / billed_revenue / direct_charge_revenue, required); `lookback_months` (2-12, default 6); `horizon_months` (1-12, default 3).

**Output rows:** `{metric, current_value, current_month, monthly_growth_rate, trend_label, projected_value, projected_month, currency, coverage}`.

**Definition tag:** `javelin_defined.project_revenue`. Source series: L2 envelope (`monthly_recurring_billed_series` / `monthly_billed_revenue_series` / `monthly_collected_charges_series`). Profile-sourced — staleness inherits from L2 (refreshed every 30 days; series is monthly-grain so 30-day staleness is invisible).

**Edge cases:** empty/missing series → sparse coverage with zeros; negative rate → projection still computed (a declining number is valid output); compounding never reaches/exceeds prior values when rate ≤ 0 (handled by goal_eta separately).

#### `project_customer_count` (Deploy 2)

Linear extrapolation of customer count forward N months using net monthly additions from L2 distributions.

**Method:** `monthly_net_additions = new_customer_distribution.median - churn_distribution.median`; `projected_value = current_count + (monthly_net_additions × horizon_months)`, floor 0. Trend label is degenerate three-way (`growing` / `flat` / `declining`) — no series → no first-half/second-half split → cannot detect acceleration/deceleration.

**Critical limitation (must be disclosed in LLM narration per Rule #10):** assumes new-customer rate AND churn rate stay flat across the horizon. Does not model acquisition acceleration or churn scaling with base size. For a fast-growing merchant, absolute churn rises with base; this method does not capture that.

**Inputs:** `horizon_months` (1-12, default 3). No `lookback_months` — L2 distributions are already trailing-6m summaries.

**Definition tag:** `javelin_defined.project_customer_count`.

#### `goal_eta` (Deploy 2)

Estimated months-to-target for a metric at current trajectory.

**Method (revenue metrics):** call `growth_rate`. If target ≤ current → state `achieved` (walk series backward to find the crossover month, return as `achieved_at_iso`; null if not in window). If rate ≤ 0 AND target > current → state `unreachable` with reason `declining`/`flat`. Else `months = ceil(log(target/current) / log(1+rate))`. If months > 60 → state `unreachable`, reason `too_distant`.

**Method (customer_count):** `monthly_net_additions` from distributions. If target ≤ current → `achieved` (no series → `achieved_at_iso` is null). If net ≤ 0 AND target > current → `unreachable`. Else `months = ceil((target - current) / net)`. Cap at 60.

**Inputs:** `metric` (recurring_revenue / billed_revenue / direct_charge_revenue / customer_count, required); `target_value` (required); `lookback_months` (revenue metrics only, 2-12, default 6). `max_horizon_months` is an internal constant (60) not exposed on the tool surface.

**Definition tag:** `javelin_defined.goal_eta`.

---

## Layer C — Derived (cut from 5b)

### `nrr` (Net Revenue Retention) — **CUT from 5b**

Stripe defines NRR only on `stripe.com/resources/more/net-revenue-retention` (marketing). No product-level canonical. Per the Plan of Record's source-hierarchy rule, marketing-only definitions don't qualify. Defer to V3 + item 23.

### `grr` (Gross Revenue Retention) — **CUT from 5b**

Same reasoning as NRR.

### `ltv`, `retention_curves`, `cohort_analysis` — **DEFERRED to V3**

Per the Plan of Record. Cohort math depends on item 23's per-merchant grounding ("what counts as a cohort for *this* merchant") and the definition surface is too contested to ship in 5b.

---

## Deferred decisions

These are flagged for explicit revisit. Each one is a known unknown — not a "we'll figure it out" but a "we have a default and we'll re-evaluate at a specific trigger."

### D1. Sigma MRR path

**Today:** MRR is computed in 5b from live Subscription objects via per-request fetch. The `subscription_enriched` row primitive is a state snapshot.

**Stripe-canonical alternative:** `subscription_item_change_events` (event stream with `mrr_change` column, `ACTIVE_START` / `ACTIVE_END` event types). This is what Stripe's own analytics use. Source: [Query billing data](https://docs.stripe.com/stripe-data/query-billing-data).

**Why not now:** Sigma is a paid Stripe add-on with a separate API surface. The app's per-merchant Stripe access is via the standard List APIs. Migrating to the events-based path requires backend-side fetching (item 1) and Sigma access provisioning per merchant.

**Reactivation trigger:** When item 23 Phase 2 lands (post item-1, backend-side fetching). Decide:
1. Whether to graduate the MRR primitive to events-based.
2. Whether Sigma access becomes part of the merchant integration.
3. Whether `subscription_enriched` becomes an event stream rather than a state snapshot, with implications for time-series accuracy.

**Why this matters:** The events-based path is incrementally maintainable (Stripe ships the deltas; we don't recompute from scratch every time) and exactly matches Stripe Dashboard MRR by construction. The state-snapshot path is good enough for 5b but will drift from Dashboard MRR at the edges (mid-period changes, proration, retroactive adjustments).

**Recommend:** stub this as a new V2 spec item (e.g., item 25 — "Sigma-backed MRR migration") so it has a stable home in the spec rather than living only in this doc.

### D2. Geography source upgrade

**Today:** `revenue_by_card_country` uses `payment_method_details.card.country` (card issuing country). Always populated for card payments; null for non-card; semantically "where the card was issued," not "where the buyer lives."

**Future option:** Add `revenue_by_billing_country` as a sibling using `billing_details.address.country` (buyer-supplied billing address). More honest for "where are my customers" questions when populated.

**Why not now:** `billing_details.address.country` is null on a substantial fraction of charges depending on the merchant's payment-flow integration. Populating it requires the merchant's checkout/payment flow to collect a billing address. Until coverage is high (or we ship a coverage-aware companion metric), the answer reads as broken.

**Reactivation trigger:** When (a) we observe a real merchant with high billing-address coverage and a clear "where are my customers" question, OR (b) item 23 Phase 1 surfaces billing-address coverage as a per-merchant profile fact, allowing the metric to be merchant-aware.

### D3. Per-merchant MRR configuration

**Today:** MRR always subtracts both recurring and one-time discounts (Stripe's strictest setting). Same for every merchant.

**Future:** Stripe's Billing analytics dashboard lets each merchant configure how MRR treats discounts. Once item 23 ships, expose that setting as a profile fact and match the merchant's chosen configuration.

**Reactivation trigger:** Item 23 Phase 1 ships and includes Stripe Dashboard MRR settings in the Layer 1 fetch.

### D4. Multi-currency display strategy

**Today:** Per-currency rows, no FX conversion. Interpreter narrates per-currency totals.

**Future:** Once item 23 ships, expose merchant's primary currency (`account.default_currency`) as a profile fact and let the interpreter decide whether to surface a converted "display total" with explicit FX disclosure.

**Reactivation trigger:** Item 23 Phase 1, or first user complaint about multi-currency narrative.

---

## Validation

Every metric definition above is enforced by fixture-based tests (per the testability rationale in the 5b kickoff discussion). Process:

1. For each metric, write a fixture payload that exercises the metric's definition and at least one edge case (trial, discount, multi-currency, refund, paused, etc., as relevant).
2. Assert exact output. Tests are tied to a metric's `definition:` string.
3. For metrics that match Stripe-canonical definitions, validate against Stripe Dashboard for the reference test account (Merchant A) before shipping. Discrepancies are either bugs in our code or genuine deviations to document.
4. Definitions doc edits and code edits ship in the same PR. Doc-without-code or code-without-doc is a process violation.

## Change log

| Date | Change | Author / decider |
|---|---|---|
| 2026-04-22 | Initial draft, all decisions ratified | session 5b kickoff |
