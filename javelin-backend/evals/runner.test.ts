// V3 single-turn eval harness.
//
// Gated behind RUN_LIVE_EVALS=1 so it never runs in CI or in the default
// `npm test` (real Anthropic calls cost money + need an API key).
//
// Run:  npm run evals
//   or: RUN_LIVE_EVALS=1 npx vitest run evals/runner.test.ts --reporter=verbose
//
// Cases live in evals/cases/*.cases.ts. Fixture data in evals/fetcherFixtures.ts.
// vi.mock'd fetchers ensure no live Stripe call ever fires from this harness.

// ── Env setup — must happen BEFORE any import that touches @ai-sdk/anthropic ──
//
// 1. Load ANTHROPIC_API_KEY from .env.local (Vitest skips .env.local in test
//    mode by design, so we read it manually).
// 2. Purge ANTHROPIC_BASE_URL — Claude Desktop's shell exports it without /v1
//    which causes 404s. See feedback_anthropic_base_url_leakage.md.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envLocal = readFileSync(
    resolve(__dirname, '..', '.env.local'),
    'utf8',
  );
  const match = envLocal.match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (match) process.env.ANTHROPIC_API_KEY = match[1].trim();
} catch {
  /* fall back to whatever env is set */
}
delete process.env.ANTHROPIC_BASE_URL;

// ── vi.mock the fetcher boundary ─────────────────────────────────────────────
//
// vi.mock is hoisted by Vitest to run before any import in this file, so the
// real lib/ask/fetchers module is never loaded — the eval-side mocks are what
// the tools see. This keeps prod code unchanged while exercising every layer
// from buildTools → tool.execute → primitive math against canned Stripe data.

import { vi, describe, it, beforeEach, beforeAll, afterAll } from 'vitest';
import type Stripe from 'stripe';
import {
  FIXTURE_SUBSCRIPTIONS,
  FIXTURE_CANCELED_SUBSCRIPTIONS,
  FIXTURE_CHARGES,
  FIXTURE_BALANCE_TRANSACTIONS,
  FIXTURE_BALANCE,
  FIXTURE_PENDING_BALANCE_TRANSACTIONS,
  FIXTURE_INVOICES,
  FIXTURE_PRODUCTS,
  FIXTURE_CUSTOMERS,
  FIXTURE_DISPUTES,
  FIXTURE_DEFAULT_CURRENCY,
  FIXTURE_SUBSCRIPTION_UPDATE_EVENTS,
  FROZEN_NOW,
} from './fetcherFixtures';

// fetchCanceledSubscriptions mock applies the same `ended_at IN period`
// filter as production so churn_count cases produce period-correct totals.
vi.mock('../lib/ask/fetchers', () => ({
  fetchActiveSubscriptions: vi.fn().mockResolvedValue(FIXTURE_SUBSCRIPTIONS),
  fetchCanceledSubscriptions: vi.fn(
    async (
      _stripe: unknown,
      _accountId: string,
      period: { start: number; end: number },
    ) =>
      FIXTURE_CANCELED_SUBSCRIPTIONS.filter(
        (sub) =>
          sub.ended_at != null &&
          sub.ended_at >= period.start &&
          sub.ended_at <= period.end,
      ),
  ),
  fetchCharges: vi.fn().mockResolvedValue(FIXTURE_CHARGES),
  fetchBalanceTransactions: vi.fn().mockResolvedValue(FIXTURE_BALANCE_TRANSACTIONS),
  fetchBalance: vi.fn().mockResolvedValue(FIXTURE_BALANCE),
  fetchPendingBalanceTransactions: vi
    .fn()
    .mockResolvedValue(FIXTURE_PENDING_BALANCE_TRANSACTIONS),
  // balance_explanation gets a period-scoped slice + a truncated flag.
  // Filter the fixture by period; truncated=false unless we ever set a tiny
  // cap in tests.
  fetchBalanceTransactionsForExplanation: vi.fn(
    async (
      _stripe: unknown,
      _accountId: string,
      period: { start: number; end: number },
    ) => ({
      transactions: FIXTURE_BALANCE_TRANSACTIONS.filter(
        (bt) => bt.created >= period.start && bt.created <= period.end,
      ),
      truncated: false,
    }),
  ),
  fetchInvoices: vi.fn().mockResolvedValue(FIXTURE_INVOICES),
  // Phase 2C-post — products fetched separately for revenue_by_plan
  // attribution fallback when price.nickname is unset.
  fetchProducts: vi.fn().mockResolvedValue(FIXTURE_PRODUCTS),
  fetchCustomers: vi.fn().mockResolvedValue(FIXTURE_CUSTOMERS),
  fetchDisputes: vi.fn().mockResolvedValue(FIXTURE_DISPUTES),
  fetchAccountDefaultCurrency: vi.fn().mockResolvedValue(FIXTURE_DEFAULT_CURRENCY),
  // ── Chunk C / 2B — customer entity tools ─────────────────────────────────
  retrieveCustomer: vi.fn(
    async (_stripe: unknown, _accountId: string, id: string) =>
      FIXTURE_CUSTOMERS.find((c) => c.id === id) ?? null,
  ),
  searchCustomersByName: vi.fn(
    async (_stripe: unknown, _accountId: string, name: string) =>
      // Multi-field exact-match search (Joy Rowe hot-fix). Mirrors the
      // production fetcher: exact match across any of name, description,
      // individual_name, business_name.
      FIXTURE_CUSTOMERS.filter(
        (c) =>
          c.name === name ||
          c.description === name ||
          (c as unknown as { individual_name?: string | null }).individual_name === name ||
          (c as unknown as { business_name?: string | null }).business_name === name,
      ),
  ),
  searchCustomersByEmail: vi.fn(
    async (_stripe: unknown, _accountId: string, email: string) =>
      FIXTURE_CUSTOMERS.filter((c) => c.email === email),
  ),
  fetchCustomersForPrefixMatch: vi.fn(
    async (_stripe: unknown, _accountId: string, prefix: string) => {
      // Multi-field prefix match (Joy Rowe hot-fix). Mirrors production:
      // case-insensitive prefix match across name, description,
      // individual_name, business_name.
      const lower = prefix.toLowerCase();
      const candidates = (c: Stripe.Customer): Array<string | null | undefined> => [
        c.name,
        c.description,
        (c as unknown as { individual_name?: string | null }).individual_name,
        (c as unknown as { business_name?: string | null }).business_name,
      ];
      return {
        matches: FIXTURE_CUSTOMERS.filter((c) =>
          candidates(c).some(
            (cand) =>
              typeof cand === 'string' && cand.toLowerCase().startsWith(lower),
          ),
        ),
        truncated: false,
      };
    },
  ),
  fetchCustomerCharges: vi.fn(
    async (
      _stripe: unknown,
      _accountId: string,
      customerId: string,
      period: { start: number; end: number },
    ) => ({
      charges: FIXTURE_CHARGES.filter(
        (ch) =>
          ch.customer === customerId &&
          ch.created >= period.start &&
          ch.created <= period.end,
      ),
      truncated: false,
    }),
  ),
  fetchCustomerInvoices: vi.fn(
    async (
      _stripe: unknown,
      _accountId: string,
      customerId: string,
      period: { start: number; end: number },
    ) =>
      FIXTURE_INVOICES.filter(
        (inv) =>
          inv.customer === customerId &&
          inv.created >= period.start &&
          inv.created <= period.end,
      ),
  ),
  fetchCustomerSubscriptions: vi.fn(
    async (_stripe: unknown, _accountId: string, customerId: string) => {
      const active = FIXTURE_SUBSCRIPTIONS.filter(
        (s) => s.customer === customerId,
      );
      const canceled = FIXTURE_CANCELED_SUBSCRIPTIONS.filter(
        (s) => s.customer === customerId,
      );
      return [...active, ...canceled];
    },
  ),
  fetchDisputesForCustomer: vi.fn(
    async (
      _stripe: unknown,
      _accountId: string,
      period: { start: number; end: number },
    ) =>
      FIXTURE_DISPUTES.filter(
        (d) => d.created >= period.start && d.created <= period.end,
      ),
  ),
  // M2 Phase 2A — subscription update events for plan-change history.
  // Filter to events whose subscription belongs to the target customer.
  fetchCustomerSubscriptionUpdateEvents: vi.fn(
    async (
      _stripe: unknown,
      _accountId: string,
      customerId: string,
      period: { start: number; end: number },
    ) => {
      // Map sub.id back to its customer using the active sub list (the
      // canceled list could also be searched but the fixture's update event
      // points at sub_acme which is active).
      const subToCustomer = new Map<string, string>();
      for (const sub of FIXTURE_SUBSCRIPTIONS) {
        subToCustomer.set(sub.id, sub.customer as string);
      }
      return FIXTURE_SUBSCRIPTION_UPDATE_EVENTS.filter(
        (evt) =>
          evt.created >= period.start &&
          evt.created <= period.end &&
          subToCustomer.get(evt.subscription.id) === customerId,
      );
    },
  ),
}));

// ── Mock getStripeClient — never instantiate a real Stripe client ────────────
//
// The tools call getStripeClient() before fetchers (the client is then passed
// to fetchers, which our mocks above ignore). Stub returns a sentinel so the
// tools' code paths run without touching real Stripe SDK / env vars.

vi.mock('../lib/ask/stripeClient', () => ({
  getStripeClient: vi.fn().mockReturnValue({ __mocked: true }),
}));

// ── Imports that depend on the mocked modules ────────────────────────────────

import { runEval } from './runner';
import { ALL_CASES } from './cases';
import { expectToolCalls, expectAnswerConstraints } from './assertions';

// ── Test suite ──────────────────────────────────────────────────────────────

describe.runIf(process.env.RUN_LIVE_EVALS)('V3 single-turn evals', () => {
  // Sequential execution per Tier 1 rate-limit math:
  //   ~7K input tokens × 18 evals = ~126K total. Tier 1 cap is 50K input/min.
  //   Sequential at ~1-2s per cached call keeps us comfortably under the cap.
  //
  // Freeze Date globally so tool wrappers' `new Date()` calls match the
  // FROZEN_NOW anchor the LLM is told is "today" via the date-injection
  // system message. Without this, primitives that compute time windows
  // internally (e.g., churn_rate's rolling-30-day) anchor to real wall-clock
  // time while the LLM anchors to 2026-04-29 — and they disagree on what
  // falls in the window.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    // Each case starts fresh; mocks return the same fixture data every time.
  });

  for (const c of ALL_CASES) {
    it(
      c.name,
      async () => {
        const { toolCalls, answerText, rawSteps } = await runEval(c.question);

        // Watch hook: for cases that intentionally OMIT maxSentences (e.g.
        // top-N enumerations where lists are allowed), log the sentence count
        // + answer text so we can keep an eye on whether outputs grow over
        // time. Cases WITH maxSentences are already guarded by the assertion.
        if (
          c.expectAnswer !== undefined &&
          c.expectAnswer.maxSentences === undefined
        ) {
          const sentenceCount =
            answerText.trim().match(/[.!?](?=\s|$)/g)?.length ?? 1;
          // eslint-disable-next-line no-console
          console.log(
            `[eval-watch] ${c.name}\n  sentences: ${sentenceCount}\n  answer: ${answerText.slice(0, 300)}${answerText.length > 300 ? '…' : ''}\n`,
          );
        }

        try {
          if (c.expectTools !== undefined) {
            expectToolCalls(toolCalls, c.expectTools);
          }
          if (c.expectAnswer !== undefined) {
            expectAnswerConstraints(answerText, c.expectAnswer);
          }
        } catch (err) {
          // On failure, dump the trajectory so the operator can see what
          // tools were actually called and what the LLM actually said.
          // eslint-disable-next-line no-console
          console.error(
            `\n[eval-fail] ${c.name}\n  question: ${c.question}\n  toolCalls: ${JSON.stringify(toolCalls, null, 2)}\n  answerText: ${answerText}\n  trajectory: ${JSON.stringify(rawSteps, null, 2)}`,
          );
          throw err;
        }
      },
      60_000, // per-case timeout — generous for LLM streaming
    );
  }
});
