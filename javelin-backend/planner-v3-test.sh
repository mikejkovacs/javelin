#!/usr/bin/env bash
# PLANNER_V3 reference test set — 25 questions
# Runs curl against the planner endpoint and validates the filterSpec response.
#
# Usage:
#   ./planner-v3-test.sh                       # hits production
#   BACKEND_URL=http://localhost:3000 ./planner-v3-test.sh   # hits dev server
#
# Requires: bash, curl, jq

set -u

BACKEND_URL="${BACKEND_URL:-https://javelin-backend.vercel.app}"
ENDPOINT="$BACKEND_URL/api/plan"

PASS=0
FAIL=0
FAIL_DETAILS=()

# Run a single test.
# Args: test_num, question, expected_resources_json, expected_dateField_or_empty,
#       expected_status_or_empty, expected_dateRange (one of: "present", "absent")
run_test() {
  local num="$1"
  local question="$2"
  local expected_resources="$3"
  local expected_datefield="$4"
  local expected_status="$5"
  local expected_daterange="$6"

  local payload
  payload=$(jq -n --arg q "$question" '{messages: [{role: "user", content: $q}]}')

  local response
  response=$(curl -sS -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "$payload")

  # Extract fields
  local got_resources got_datefield got_status got_daterange
  got_resources=$(echo "$response" | jq -c '.resources | sort')
  got_datefield=$(echo "$response" | jq -r '.serverSide.dateField // ""')
  got_status=$(echo "$response" | jq -r '.serverSide.status // ""')
  if echo "$response" | jq -e '.serverSide.dateRange' > /dev/null 2>&1; then
    got_daterange="present"
  else
    got_daterange="absent"
  fi

  local expected_resources_sorted
  expected_resources_sorted=$(echo "$expected_resources" | jq -c 'sort')

  local errs=()
  [ "$got_resources" != "$expected_resources_sorted" ] && \
    errs+=("resources: expected $expected_resources_sorted, got $got_resources")
  [ "$got_datefield" != "$expected_datefield" ] && \
    errs+=("dateField: expected '$expected_datefield', got '$got_datefield'")
  [ "$got_status" != "$expected_status" ] && \
    errs+=("status: expected '$expected_status', got '$got_status'")
  [ "$got_daterange" != "$expected_daterange" ] && \
    errs+=("dateRange: expected $expected_daterange, got $got_daterange")

  if [ ${#errs[@]} -eq 0 ]; then
    printf "\e[32mPASS\e[0m %2d. %s\n" "$num" "$question"
    PASS=$((PASS + 1))
  else
    printf "\e[31mFAIL\e[0m %2d. %s\n" "$num" "$question"
    for e in "${errs[@]}"; do
      printf "        %s\n" "$e"
    done
    printf "        raw response: %s\n" "$response"
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$num. $question")
  fi
}

echo "Running PLANNER_V3 reference test set against $ENDPOINT"
echo "─────────────────────────────────────────────────────────────"

# ── Regression — existing 6 ────────────────────────────────────────────────
run_test  1 "How many customers do I have in Stripe?"      '["customers"]'                                                ""          ""         "absent"
run_test  2 "What was Q4 2025 revenue?"                    '["invoices","charges"]'                                       ""          ""         "present"
run_test  3 "What invoices were created in Q4 2025?"       '["invoices"]'                                                 "created"   ""         "present"
run_test  4 "How many customers churned last month?"       '["subscriptions","invoices"]'                                 ""          ""         "present"
run_test  5 "Thanks!"                                      '[]'                                                           ""          ""         "absent"
run_test  6 "From Jan 1 2026 until today"                  '["invoices","charges"]'                                       ""          ""         "present"

# ── New single-resource — 12 ───────────────────────────────────────────────
run_test  7 "How much did I collect last month?"           '["charges"]'                                                  ""          ""         "present"
run_test  8 "How much in refunds did I issue this quarter?" '["charges"]'                                                 ""          ""         "present"
run_test  9 "How much came in via one-time payments last month?" '["payment_intents"]'                                    ""          ""         "present"
run_test 10 "What's my current Stripe balance?"            '["balance"]'                                                  ""          ""         "absent"
run_test 11 "What's my net revenue after fees last month?" '["charges"]'                                                  ""          ""         "present"
run_test 11 "What was my net cash in March?"               '["charges"]'                                                  ""          ""         "present"
run_test 12 "When was my last payout?"                     '["payouts"]'                                                  ""          ""         "absent"
run_test 13 "How many payouts failed last month?"          '["payouts"]'                                                  ""          "failed"   "present"
run_test 14 "What's my dispute rate this year?"            '["disputes"]'                                                 ""          ""         "present"
run_test 15 "How many payments are under Radar review?"    '["reviews"]'                                                  ""          ""         "absent"
run_test 16 "How much tax did I collect in Q4 2025?"       '["tax"]'                                                      ""          ""         "present"
run_test 17 "What's my outstanding tax liability?"         '["tax"]'                                                      ""          ""         "absent"
run_test 18 "How many connected accounts do I have?"       '["connected_accounts"]'                                       ""          ""         "absent"

# ── New multi-resource — 3 ─────────────────────────────────────────────────
run_test 19 "How much did I make last month?"              '["invoices","charges"]'                                       ""          ""         "present"
run_test 20 "How is my platform doing this year?"          '["connected_accounts","application_fees","transfers"]'        ""          ""         "present"
run_test 21 "How much did I earn in platform fees in Q4?"  '["application_fees"]'                                         ""          ""         "present"

# ── Edge / routing nuance — 3 ──────────────────────────────────────────────
run_test 22 "Hello"                                        '[]'                                                           ""          ""         "absent"
run_test 23 "What's my MRR?"                               '["subscriptions"]'                                            ""          ""         "absent"
run_test 24 "What plans do I offer?"                       '["products"]'                                                 ""          ""         "absent"

# ── Disambiguation pressure — 2 ────────────────────────────────────────────
run_test 25 "How many payments came in last month?"        '["payment_intents"]'                                          ""          ""         "present"
run_test 26 "How many customers pay with Visa?"            '["charges"]'                                                  ""          ""         "absent"

echo "─────────────────────────────────────────────────────────────"
printf "Passed: \e[32m%d\e[0m   Failed: \e[31m%d\e[0m   Total: %d\n" "$PASS" "$FAIL" $((PASS + FAIL))

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failed tests:"
  for t in "${FAIL_DETAILS[@]}"; do
    echo "  $t"
  done
  exit 1
fi

exit 0
