// V3 few-shot worked examples. Trimmed for Sonnet 4.6 in Phase 2B' — dropped
// 4 examples that taught patterns Sonnet handles inferentially:
//   - Net revenue after refunds/chargebacks (covered by fraud filter example)
//   - "Thanks!" conversational
//   - "How are sales last week?" empty-period (covered by WHEN DATA rule)
//   - When do I hit $100K MRR (duplicate projection guidance)
//
// Customer names, amounts, percentages, dates are illustrative — preamble
// explicitly tells the LLM that.

export const FEW_SHOT_EXAMPLES = `EXAMPLES OF GOOD BEHAVIOR
The customer names, dollar amounts, percentages, and dates in these examples are illustrative — your answer must reflect the values the tools actually return.

Q: "How much did I collect last month?" (today 2026-04-28)
→ period_collected_revenue({start:"2026-03-01", end:"2026-03-31"})
  → rows:[{currency:"usd", collected_revenue:4820, charge_count:142}]
A: Last month you collected $4,820 across 142 charges.

Q: "Who are my top 5 customers?"
→ customer_concentration({start:"2025-04-28", end:"2026-04-28", top_n:5})
  → top_5_customers:[
      {name:"Acme Corp", amount:1840},
      {name:"Globex Inc", amount:1290},
      {name:"Initech LLC", amount:980},
      {name:"Hooli Co", amount:740},
      {name:"Aperture Sci", amount:520}
    ], top_5_share:0.34
A: Your top 5 customers in the trailing 12 months — about 34% of total revenue:
- **Acme Corp** — $1,840
- **Globex Inc** — $1,290
- **Initech LLC** — $980
- **Hooli Co** — $740
- **Aperture Sci** — $520

Q: "What's my MRR growth rate?"
→ growth_rate({metric:"recurring_revenue", window:6})
  → avg_growth_rate:0.04, trend_label:"accelerating", coverage:"full"
A: Your recurring billings have been growing about 4% month-over-month over the last 6 months, and the trend is accelerating — second-half rates ran higher than first-half.

Q: "What's my churn rate?"
→ churn_rate({})
  → value:0.062, components:{churned_30d:4, active_30d_ago:60, new_30d:5}
A: Your 30-day rolling churn rate is about 6%, with 4 subscribers churning out of a base of 65 (60 active 30 days ago plus 5 new). That's the Stripe-canonical rolling-30-day formula.

Q: "How much bigger is my top customer than my median customer?"
→ customer_concentration({start:"2025-04-28", end:"2026-04-28", top_n:1})
  → top_1_customer:{display_name:"top.customer@example.com", amount:7030}
→ customer_spend_distribution({start:"2025-04-28", end:"2026-04-28"})
  → median:480, mean:1870, p25:120, p75:1450, paying_customer_count:106, low_sample:false
A: Your top customer (top.customer@example.com) paid CAD 7,030 in the trailing 12 months; your median paying customer paid CAD 480 — about 14× larger. Distribution skews top-heavy: median CAD 480, mean CAD 1,870.

Q: "How are sales this month?" (today 2026-04-28)
→ period_billed_revenue({start:"2026-04-01", end:"2026-04-28"})
  → rows:[{currency:"usd", billed_revenue:4200, invoice_count:14}]
→ period_collected_revenue({start:"2026-04-01", end:"2026-04-28"})
  → rows:[{currency:"usd", collected_revenue:3450, charge_count:89}]
A: Month-to-date (April 1-28) you billed $4,200 across 14 invoices and collected $3,450 across 89 charges. April isn't done yet.

Q: "Where will my MRR be in 6 months?"
→ project_revenue({metric:"recurring_revenue", lookback_months:6, horizon_months:6})
  → current_value:4820, monthly_growth_rate:0.04, trend_label:"accelerating",
    projected_value:6097, projected_month:"2026-11"
A: At your current 4% monthly trend over the last 6 months — and growth has been accelerating — you'd land around \$6,100 MRR by November if the trajectory holds.

Q: "When do I hit 1,000 customers?"
→ goal_eta({metric:"customer_count", target_value:1000})
  → state:"reachable", months_to_target:18, target_eta_iso:"2027-11",
    monthly_net_additions:25, trend_label:"growing"
A: Assuming your new-customer and churn rates stay flat — about 25 net new customers per month — you'd reach 1,000 around November 2027.

Q: "What's my ARPU?" (merchant has both subs and one-time revenue)
→ arpu({basis:"recurring"})
  → rows:[{currency:"usd", arpu:209.57, source_revenue:4820, customer_count:23, basis:"recurring", low_sample:false}]
→ arpu({basis:"collected", start:"2025-04-28", end:"2026-04-28"})
  → rows:[{currency:"usd", arpu:312.40, source_revenue:34250, customer_count:110, basis:"collected", low_sample:false}]
A: Two lenses on this since you have both subs and one-time revenue:
- **Per active subscriber (run-rate)** — about $210/mo (MRR $4,820 ÷ 23 active subs).
- **Per paying customer (trailing 12 months)** — about $312 (collected $34,250 ÷ 110 customers).

Q: "What was my real revenue last month after fraud?" (today 2026-04-28)
→ period_net_revenue({start:"2026-03-01", end:"2026-03-31", exclude_fraud:true})
  → rows:[{currency:"usd", net_revenue:4480, gross_collected:4780, refunds:200, chargebacks:100, fraud_excluded:40}]
A: March net revenue after fraud was $4,480 — $4,780 collected, less $200 in refunds, $100 in chargebacks, and $40 stripped as fraudulent.

Q: "What's going on with Acme lately?"
→ customer_lookup({query:"Acme"}) → customer_id:"cus_abc"
→ customer_recent_activity({customer_id:"cus_abc"})
  → rows:[{type:"subscription_item_change", occurred_at_iso:"2026-04-15", description:"Plan changed to Pro"}, {type:"charge", occurred_at_iso:"2026-04-01", description:"Paid $99.00", amount:99}],
    upcoming_cancellations:[{plan_name:"Pro", cancels_at_iso:"2026-05-30"}]
A: Acme upgraded to Pro on April 15 and paid $99 on April 1. Heads up — their Pro subscription is set to cancel May 30.

Q: "Show me revenue by plan in April 2026." (mixed-merchant: subscription tail + direct charges)
→ revenue_by_plan({start:"2026-04-01", end:"2026-04-30"})
  → rows:[{plan_name:"unattributed", amount:26815, charge_count:37, share:0.991}, {plan_name:"Advice Access", amount:245, charge_count:1, share:0.009}], total:27060
→ revenue_by_plan_billed({start:"2026-04-01", end:"2026-04-30"})
  → rows:[{plan_name:"Advice Access", currency:"cad", amount:245, invoice_count:1, share:1.0}], totals_by_currency:{cad:245}
A: Two lenses on April. **Billed via invoices** — \$245 from Advice Access (1 invoice). **Collected via charges** — \$27,060 total, of which \$245 was Advice Access charges and \$26,815 was direct charges not tied to a plan. The direct-charge bulk is one-time payment volume rather than subscription billing.

Q: "Which plans are growing month over month?" (pure-SaaS — most revenue is invoice-billed)
→ revenue_by_plan({start:"2026-02-01", end:"2026-04-30", granularity:"month"})
  → buckets:["2026-02","2026-03","2026-04"], plans:[{plan_name:"Pro Monthly", total:7800, ...}, {plan_name:"Starter Monthly", total:1400, ...}], total:9200
→ revenue_by_plan_billed({start:"2026-02-01", end:"2026-04-30", granularity:"month"})
  → buckets:["2026-02","2026-03","2026-04"], groups:[
      {plan_name:"Pro Monthly", currency:"usd", total:7800, series:[{bucket:"2026-02", amount:2200}, {bucket:"2026-03", amount:2600}, {bucket:"2026-04", amount:3000}]},
      {plan_name:"Starter Monthly", currency:"usd", total:1400, series:[{bucket:"2026-02", amount:500}, {bucket:"2026-03", amount:450}, {bucket:"2026-04", amount:450}]}
    ], totals_by_currency:{usd:9200}
A: Across the last three months — Pro Monthly grew from \$2,200 (Feb) to \$2,600 (Mar) to \$3,000 (Apr). Starter Monthly held roughly flat: \$500 → \$450 → \$450. Collected and billed track closely here since most of your revenue comes through subscription invoices.

Q: "Show me revenue by country over the last three months." (today 2026-05-08)
→ revenue_by_country({start:"2026-02-01", end:"2026-04-30", granularity:"month"})
  → buckets:["2026-02","2026-03","2026-04"], groups:[
      {country:"CA", currency:"cad", total:6800, charge_count:9, series:[
        {bucket:"2026-02", amount:2000, charge_count:3},
        {bucket:"2026-03", amount:2400, charge_count:3},
        {bucket:"2026-04", amount:2400, charge_count:3}]},
      {country:"US", currency:"cad", total:1200, charge_count:3, series:[
        {bucket:"2026-02", amount:400, charge_count:1},
        {bucket:"2026-03", amount:400, charge_count:1},
        {bucket:"2026-04", amount:400, charge_count:1}]}
    ], totals_by_currency:{cad:8000}
A: Country here is the card-issuing country (BIN-derived). In CAD over Feb–Apr — Canada CA\$2,000 → CA\$2,400 → CA\$2,400; US CA\$400/month flat.

Q: "How did my MRR change in March?" (today 2026-05-08)
→ mrr_movement({start:"2026-03-01", end:"2026-03-31"})
  → metric_type:"flow", rows:[
      {bucket:"new", currency:"usd", amount:50, event_count:2},
      {bucket:"expansion", currency:"usd", amount:30, event_count:1},
      {bucket:"churned", currency:"usd", amount:-25, event_count:1}
    ],
    events:[
      {bucket_type:"expansion", date_iso:"2026-03-15", customer_display_name:"Acme Corp", plan_name:"Pro Monthly", amount:30, prior_amount:200},
      {bucket_type:"churned", date_iso:"2026-03-28", customer_display_name:"Hooli Co", plan_name:"Starter Monthly", amount:-25}
    ], totals_by_currency:{usd:{new:50, expansion:30, contraction:0, churned:-25, net:55}}
A: Net MRR added \$55 in March — \$50 from 2 new subs, \$30 from an Acme upgrade, offset by \$25 when Hooli churned.

Q: "What's my current MRR and how has it changed lately?" (today 2026-05-08)
→ mrr({})
  → metric_type:"state", rows:[{currency:"usd", mrr:4820, subscription_count:23}]
→ mrr_movement({start:"2026-04-08", end:"2026-05-08"})
  → metric_type:"flow", rows:[{bucket:"new", currency:"usd", amount:75, event_count:3}, {bucket:"churned", currency:"usd", amount:-50, event_count:2}],
    totals_by_currency:{usd:{new:75, expansion:0, contraction:0, churned:-50, net:25}}
A: Your current MRR is \$4,820 across 23 active subs. Over the last 30 days the install base shifted by a net \$25 — \$75 from 3 new subs against \$50 lost from 2 churns.

Q: "What were my failed payments in March?" (today 2026-05-08)
→ failed_payments({start:"2026-03-01", end:"2026-03-31"})
  → rows:[{currency:"cad", total_failed:10475.10, count:3, breakdown:{failed_charges:{amount:10475.10, count:3}, failed_invoice_attempts:{amount:0, count:0}}}],
    top_failures:[{customer_display_name:"billing@northwind.example", amount:3491.70, currency:"cad", occurred_at_iso:"2026-03-17", failure_type:"charge", failure_reason_category:"insufficient_funds"}],
    failure_reasons:[{category:"insufficient_funds", count:3, total_amount:10475.10}]
A: March had 3 failed payments totaling CA$10,475 — all from billing@northwind.example on March 17, three CA$3,491.70 attempts with insufficient_funds. Looks like one customer's card declined repeatedly.`;
