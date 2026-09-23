#!/usr/bin/env bash
# Interpreter reference test set — confabulation guardrails (item 19)
# Sends crafted question + filterSpec + stripeData payloads to /api/chat and
# asserts that forbidden substrings (un-fetched figures, technical wording)
# do NOT appear in the streamed response. Lighter than planner tests —
# negative assertions only.
#
# Usage:
#   ./interpreter-test.sh                       # hits production
#   BACKEND_URL=http://localhost:3000 ./interpreter-test.sh   # hits dev server
#
# Requires: bash, curl, jq

set -u

BACKEND_URL="${BACKEND_URL:-https://javelin-backend.vercel.app}"
ENDPOINT="$BACKEND_URL/api/chat"

PASS=0
FAIL=0
FAIL_DETAILS=()

# Run a single test.
# Args: test_num, label, payload_json, forbidden_regex_newline_separated, [required_regex]
#   forbidden_regex_newline_separated: one regex per line (case-insensitive). If ANY match, FAIL.
#   required_regex: optional. If provided and does NOT match, FAIL.
run_test() {
  local num="$1"
  local label="$2"
  local payload="$3"
  local forbidden="$4"
  local required="${5:-}"

  local response
  response=$(curl -sS -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "$payload")

  local errs=()

  # Forbidden substring checks (case-insensitive, one regex per line)
  if [ -n "$forbidden" ]; then
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      if echo "$response" | grep -iqE "$p"; then
        local hit
        hit=$(echo "$response" | grep -ioE "$p" | head -1)
        errs+=("forbidden match: '$p' → '$hit'")
      fi
    done <<< "$forbidden"
  fi

  # Required substring check
  if [ -n "$required" ]; then
    if ! echo "$response" | grep -iqE "$required"; then
      errs+=("required pattern missing: '$required'")
    fi
  fi

  if [ ${#errs[@]} -eq 0 ]; then
    printf "\e[32mPASS\e[0m %2d. %s\n" "$num" "$label"
    PASS=$((PASS + 1))
  else
    printf "\e[31mFAIL\e[0m %2d. %s\n" "$num" "$label"
    for e in "${errs[@]}"; do
      printf "        %s\n" "$e"
    done
    printf "        response: %s\n" "$(echo "$response" | head -c 500)"
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$num. $label")
  fi
}

echo "Running interpreter reference test set against $ENDPOINT"
echo "─────────────────────────────────────────────────────────────"

# ── Confabulation — un-fetched figures ────────────────────────────────────

# 1. The original bug: charges-only payload must not volunteer processing fees.
run_test 1 "collection question with charges-only — no fees invented" \
  "$(jq -n '{
    messages: [{role: "user", content: "How much did I collect last month?"}],
    filterSpec: {resources: ["charges"], serverSide: {dateRange: {start: 1741996800, end: 1744675200}}, clientSide: {}},
    stripeData: {
      charges: [
        {id: "ch_1", amount: 50000, currency: "usd", status: "succeeded", created: 1742000000, paid: true},
        {id: "ch_2", amount: 139042, currency: "usd", status: "succeeded", created: 1743000000, paid: true}
      ]
    }
  }')" \
  "processing fee
stripe fee
paid.*in fees
lost.*in fees
\\\$[0-9]+.*fee"

# 2. MRR question with subscriptions-only — no churn rate volunteered.
run_test 2 "MRR question — no churn rate invented" \
  "$(jq -n '{
    messages: [{role: "user", content: "What is my MRR?"}],
    filterSpec: {resources: ["subscriptions"], serverSide: {status: "active"}, clientSide: {}},
    stripeData: {
      subscriptions: [
        {id: "sub_1", status: "active", items: {data: [{price: {unit_amount: 2500, recurring: {interval: "month", interval_count: 1}}}]}},
        {id: "sub_2", status: "active", items: {data: [{price: {unit_amount: 5000, recurring: {interval: "month", interval_count: 1}}}]}}
      ]
    }
  }')" \
  "churn rate of [0-9]
[0-9]+% churn
churn.{0,30}[0-9]+%"

# 3. Revenue trend question — no conversion rate invented.
run_test 3 "revenue question — no conversion rate invented" \
  "$(jq -n '{
    messages: [{role: "user", content: "How is my revenue trending?"}],
    filterSpec: {resources: ["invoices"], serverSide: {status: "paid", dateRange: {start: 1735689600, end: 1744675200}}, clientSide: {}},
    stripeData: {
      invoices: [
        {id: "in_1", amount_paid: 250000, status: "paid", created: 1736000000},
        {id: "in_2", amount_paid: 300000, status: "paid", created: 1739000000},
        {id: "in_3", amount_paid: 275000, status: "paid", created: 1742000000}
      ]
    }
  }')" \
  "conversion rate
[0-9]+% conversion"

# 4. Subscription revenue question — no ARPU volunteered.
run_test 4 "subscription revenue — no ARPU invented" \
  "$(jq -n '{
    messages: [{role: "user", content: "How much revenue from subscriptions?"}],
    filterSpec: {resources: ["subscriptions"], serverSide: {status: "active"}, clientSide: {}},
    stripeData: {
      subscriptions: [
        {id: "sub_1", status: "active", items: {data: [{price: {unit_amount: 2500, recurring: {interval: "month"}}}]}},
        {id: "sub_2", status: "active", items: {data: [{price: {unit_amount: 5000, recurring: {interval: "month"}}}]}}
      ]
    }
  }')" \
  "ARPU
average revenue per user
average revenue per customer"

# 5. Net revenue question with charges-only — no net figure invented.
run_test 5 "net revenue with gross-only data — no fabricated net" \
  "$(jq -n '{
    messages: [{role: "user", content: "What was my net revenue last month?"}],
    filterSpec: {resources: ["charges"], serverSide: {dateRange: {start: 1741996800, end: 1744675200}}, clientSide: {}},
    stripeData: {
      charges: [
        {id: "ch_1", amount: 100000, currency: "usd", status: "succeeded", paid: true}
      ]
    }
  }')" \
  "net revenue (is|was|of).*\\\$
net (of|after) fees.*\\\$[0-9]+"

# 6. Fees question with wrong data (invoices-only) — must not fabricate a total.
run_test 6 "fees question with invoices-only — asks for right data" \
  "$(jq -n '{
    messages: [{role: "user", content: "How much did I pay Stripe in fees last quarter?"}],
    filterSpec: {resources: ["invoices"], serverSide: {status: "paid"}, clientSide: {}},
    stripeData: {
      invoices: [
        {id: "in_1", amount_paid: 500000, status: "paid"}
      ]
    }
  }')" \
  "paid.{0,40}\\\$[0-9]+.{0,20}(in fees|in processing)
fees (were|totaled).*\\\$"

# 7. Customer count question with wrong payload — must not invent a count.
run_test 7 "customer count with wrong payload — no fabricated count" \
  "$(jq -n '{
    messages: [{role: "user", content: "How many customers do I have?"}],
    filterSpec: {resources: ["invoices"], serverSide: {}, clientSide: {}},
    stripeData: {
      invoices: [
        {id: "in_1", customer: "cus_A", amount_paid: 10000, status: "paid"},
        {id: "in_2", customer: "cus_B", amount_paid: 20000, status: "paid"}
      ]
    }
  }')" \
  "you have [0-9]+ customer
[0-9]+ total customer
total of [0-9]+ customer"

# ── Technical-wording leaks (Radar/empty polish) ──────────────────────────

# 8. Empty Radar reviews — no "array" leak.
run_test 8 "empty reviews — plain English, no 'array'" \
  "$(jq -n '{
    messages: [{role: "user", content: "Any payments under Radar review?"}],
    filterSpec: {resources: ["reviews"], serverSide: {}, clientSide: {}},
    stripeData: {reviews: []}
  }')" \
  "array
empty (array|list|object)
payload
\\.data
no records
no entries" \
  "no (payments|radar|review|transactions)"

# 9. Empty disputes — no technical wording.
run_test 9 "empty disputes — plain English" \
  "$(jq -n '{
    messages: [{role: "user", content: "Any chargebacks this month?"}],
    filterSpec: {resources: ["disputes"], serverSide: {dateRange: {start: 1741996800, end: 1744675200}}, clientSide: {}},
    stripeData: {disputes: []}
  }')" \
  "array
empty (array|list|object)
payload
\\.data
no records
no entries"

# 10. Empty payouts — no technical wording.
run_test 10 "empty payouts — plain English" \
  "$(jq -n '{
    messages: [{role: "user", content: "Any payouts in the last week?"}],
    filterSpec: {resources: ["payouts"], serverSide: {dateRange: {start: 1744070400, end: 1744675200}}, clientSide: {}},
    stripeData: {payouts: []}
  }')" \
  "array
empty (array|list|object)
payload
\\.data
no records
no entries"

# ── Pattern C unsupported-resource markers (item 18 v0.0.7 smoke-test fix) ──

# 11. Meter-events question — acknowledges in business terms, no system-failure vocabulary.
run_test 11 "meter_events unsupported — business framing, not an error" \
  "$(jq -n '{
    messages: [{role: "user", content: "How many meter events did I record this month?"}],
    filterSpec: {resources: ["meter_events"], serverSide: {}, clientSide: {}},
    stripeData: {meterEvents: {unsupported: true, resource: "meter_events"}}
  }')" \
  "error
something went wrong
unsupported
not supported
payload
\\.data" \
  "later release|coming|yet"

# 12. Tax question — same shape, different resource.
run_test 12 "tax unsupported — business framing, not an error" \
  "$(jq -n '{
    messages: [{role: "user", content: "How much tax did I collect last quarter?"}],
    filterSpec: {resources: ["tax"], serverSide: {}, clientSide: {}},
    stripeData: {tax: {unsupported: true, resource: "tax"}}
  }')" \
  "error
something went wrong
unsupported
not supported
payload
\\.data" \
  "later release|coming|yet"

# 13. Usage-records question — same shape, third resource.
run_test 13 "usage_records unsupported — business framing, not an error" \
  "$(jq -n '{
    messages: [{role: "user", content: "How many API calls did my customers make last month?"}],
    filterSpec: {resources: ["usage_records"], serverSide: {}, clientSide: {}},
    stripeData: {usageRecords: {unsupported: true, resource: "usage_records"}}
  }')" \
  "error
something went wrong
unsupported
not supported
payload
\\.data" \
  "later release|coming|yet"

echo "─────────────────────────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo
  echo "Failed tests:"
  for d in "${FAIL_DETAILS[@]}"; do
    echo "  - $d"
  done
  exit 1
fi
