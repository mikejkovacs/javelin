# Tool lifecycle — how Javelin shipped Tools 8-13 fast

**Status:** Reference, captured 2026-04-30 after Step 3 / Deploys 2 + 3 wrapped.
**Companion to:** `feedback_javelin_working_mode.md` (memory) — that file holds the standing rules; this doc holds the detailed lifecycle playbook.

---

## The contract that made it work

Three sets of behavior with explicit boundaries.

### What the assistant does autonomously (no checkpoint)

- **Mechanical file writes.** Tool wrappers (mirroring an existing tool), `lib/ask/tools/index.ts` registrations, `lib/metrics/index.ts` barrel exports, chip-label additions in `shimmerPhrases.ts`, runner mock additions for new fetchers, eval-cases-index registrations, frontend version bumps in `stripe-app.json`.
- **Eval runs + reporting.** `npm run evals` after every change that could affect tool behavior. Report pass/fail per case and troubleshoot failures.
- **Type B eval-failure fixes.** When the LLM gives a correct answer that fails a too-strict assertion (digit vs word, sentence cap +1, `expectTools` count off because the LLM started using N+1 tools), fix the assertion and re-run without asking. Examples from this session: `mustInclude: ['6']` → `mustMatch: [/\b(6|six)\b/i]` after LLM said "Six"; dropping `expectTools` when the LLM started calling `churn_count` + `churn_reasons` together for "why did people cancel"; bumping a `maxSentences` cap from 5 to 7.
- **In-session iteration loops.** When evals fail on first run, fix and re-run autonomously. Report only the final state, not every iteration.
- **PCL watch-item logging.** Observations of voice/format drift logged without asking (currency formatting, action-recommendations, etc.).

### What still requires user review / approval

- **Stripe-canonical research before each new metric.** Non-negotiable. Every primitive's `definition` tag traces to a Stripe source.
- **Primitive design.** Input/output envelope shape, edge case handling, threshold values, signal flags (`breakdown_significance`, `coverage`, `direction` enum). Shown before writing.
- **Eval case design.** Question phrasings, assertion shapes, calibrated values. Shown before writing.
- **CRITICAL RULE additions to the system prompt.** Any change to `portedRules.ts` that affects LLM behavior across all tools (Rules #8 and #9 both went through tradeoff + numbered options + user pick).
- **Tool description content** (because it's behavior-load-bearing). Tool wrapper *code* the assistant writes without showing; tool *description string* gets surfaced.
- **Deploys.** `vercel --prod` and `stripe apps upload` — always user-driven.
- **Production validation against real Stripe data.** Numbers vs Dashboard — only the user can do that.

### What stays slow on purpose

- The Stripe-canonical research pass (WebFetch on Stripe docs, cite source URLs in primitive docstrings).
- Numbered tradeoff options whenever there are real tradeoffs.
- Per-tool primitive review.
- Per-tool calibration math (eval `CALIBRATED` entries computed by hand, never derived).
- Production validation between deploys.

---

## The session loop that emerged

For a single tool or pair:

```
1. [USER] Brings the question / locks the design discussion.
2. [ASST] Stripe-canonical research (WebFetch). Surface findings + open Qs.
3. [USER] Answers Qs, locks design choices.
4. [ASST] Show primitive design + eval cases. Wait for greenlight.
5. [USER] Greenlight (or push back).
6. [ASST] Implement everything (primitive + tests + fetcher + tool wrapper +
          tool tests + mechanical wiring + fixture + CALIBRATED + eval cases +
          cross-cutting updates + frontend version bump).
7. [ASST] Run unit tests. Run evals. Iterate Type B fixes autonomously.
8. [ASST] Report final state with diffs summary, hand to user for deploy.
9. [USER] Deploy backend + frontend, validate in prod.
10.[USER] Report validation back; if voice tweak needed, return to step 4.
```

This is meaningfully tighter than the original "show every step" rhythm because steps 6 and 7 collapsed from "checkpoint after each file" to "implement everything, then verify with evals."

---

## Deploy cadence (Tier 2-E pattern)

After lots of single-tool deploys early in Step 3, the rhythm moved to **2-tool deploy batches** for the last four:

- **Deploy 2:** `paying_customer_count` + `revenue_by_plan`
- **Deploy 3:** `churn_rate` + `compare_periods`

Pairing rule (after dropping Tier 2-F): **dependency order**, not data-source proximity. `compare_periods` landed last because it wraps other tools (so they had to be live first). Otherwise pair by independence.

Hot-fixes shipped solo (e.g. CRITICAL RULE #8 → CRITICAL RULE #9 + CAD format) when the change was small and the user wanted it tested before continuing.

---

## Pre-baked conventions (Tier 1-C)

Defaults rather than per-tool decisions:

- **Number assertions:** `mustMatch: [/\b(N|word)\b/i]` instead of `mustInclude: ['N']`. The LLM produces "Six" or "6" interchangeably.
- **Empty-period cases:** No `mustInclude` on the count. LLM may say "0" or "no" or "none"; let the watch hook log.
- **Composite questions:** `argsDateRangeTolerant` not `argsExact`. The LLM has interpretive latitude on natural-language periods.
- **Tool wrapper structure:** `try { ... } catch (err) { console.error('[ask] X tool execute() failed:', err); throw err; }` — direct mirror of existing wrappers, no review needed.
- **Schema test:** 3-4 tests per tool wrapper (accepts valid, rejects malformed, rejects extra fields, rejects missing fields). Always identical structure.
- **Chip label format:** `'<verb>ing <thing>…'` — "Computing", "Pulling", "Counting", "Comparing", "Reading". Trailing ellipsis.

---

## Batch-design (Tier 2-D)

For Deploys 2 + 3, the assistant produced one big design pass covering multiple tools at once. Per-tool format:

1. Stripe-canonical definition + source URLs
2. Primitive design (input/output envelope)
3. Fetcher needs (existing or new)
4. Tool description draft
5. Eval shape (1-3 cases per tool, with calibrated values)
6. Open questions specific to that tool

Then a synthesis section: cross-cutting decisions, prefix-size impact, sequencing within deploys, anything affecting cache threshold.

That pass took ~45 min of dense reading on the user's end but front-loaded all the thinking. Implementation then moved without further design checkpoints.

**Caveat:** in this session it ended up as 2-tool batches (D-4 = "churn_reasons solo + batch-design the remaining 4") rather than full 5-tool because we wanted to validate `churn_reasons` first. The batch-of-4 still front-loaded enough to be effective.

---

## Two failure modes worth pre-empting

These came up multiple times. Pre-empting them in future sessions saves time.

### 1. Stale system-prompt examples after a tool ships

When `churn_rate` shipped, the few-shot example in `fewShotExamples.ts` still said "What's my churn rate?" → refuse. The LLM kept refusing because of the few-shot pattern, not because the tool was missing.

**Fix:** when shipping a tool that fills a previously-unsupported metric, audit BOTH `portedRules.ts` AND `fewShotExamples.ts` for stale references in the same PR. The CRITICAL RULE example AND the few-shot worked example both need updating.

### 2. Cross-cutting eval cases drift as new tools land

The composite "how did Q1 go?" eval case kept failing across deploys because the LLM picked richer tool combinations as more tools became available. Each deploy = the LLM picked one more tool than the prior expectation.

**Fix:** for open-ended composite eval cases, prefer dropping `expectTools` and asserting only on answer content. Tight-tool-selection assertions belong on focused single-question cases, not composite ones.

---

## Token / cache discipline

The cached system-prefix grew from ~6,100 tokens at V3 ship (2026-04-28) to ~7,750 at end of Step 3 (2026-04-30). Trim trigger sits at 8K (Haiku 4.5 cache threshold ~4096; we hold ~75% margin above the threshold, ~250 tokens below the trim trigger).

When a CRITICAL RULE addition pushes prefix significantly, surface the token impact in the proposal. If we ever hit 8K, trim the FORMAT block or compress few-shot examples first — those are highest-token-density and most replaceable.

---

## What this rhythm does NOT cover

- **First UI work** (Chunk 2 — Thread UI). UI involves design dimensions (information architecture, interaction patterns) and platform constraints (Stripe Apps SDK + UI extensions + design guidelines) that don't have analogues here. Expect a different rhythm: heavy upfront research, IA proposals, UX choreography, before any implementation.
- **Brand-new metric definitions** that don't have Stripe canonical (e.g., methodology-explanation work, Item 26 in the V2 spec). The Stripe-canonical research pass falls back to "Javelin-defined with documented rationale" — which is more design work, not less.
- **Prompt-engineering iteration without a tool change.** Voice fixes, framing changes, CRITICAL RULE additions — these still go through tradeoff + numbered options + explicit user pick. Don't compress prompt iteration the way we compressed tool iteration.
