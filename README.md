# Javelin

**Ask plain-English questions about your Stripe business, right inside the Stripe Dashboard.**

Javelin is a [Stripe App](https://docs.stripe.com/stripe-apps) that adds a chat drawer to the Stripe Dashboard. A merchant types a question — *"What's my MRR?"*, *"Why did revenue drop in March?"*, *"Who are my top customers?"*, *"When will I hit $50k MRR?"* — and gets a short, sourced answer computed from their live Stripe data.

Under the hood, Claude (via the [Vercel AI SDK](https://ai-sdk.dev)) picks from **30 deterministic metric tools** (MRR, churn, ARPU, LTV, MRR movement, failed payments, revenue by plan/country, projections, and more). The model decides *which* numbers to fetch and how to explain them; the numbers themselves are computed in plain TypeScript against the Stripe API, using [Stripe's own metric definitions](Build%20plan/metric-definitions.md) wherever Stripe publishes one.

## How it works

```
┌─────────────────────────────┐   signed request    ┌──────────────────────────────┐
│  Stripe Dashboard           │ ──────────────────► │  javelin-backend (Next.js)   │
│  └─ Javelin drawer          │   (Stripe App       │  /api/ask                    │
│     javelin/  (UI extension)│    signature)       │   ├─ verify signature        │
│                             │ ◄────────────────── │   ├─ Claude + 30 tools ──────┼──► Stripe API
│                             │   streamed answer   │   │   (stripeAccount=merchant)│    (merchant data)
└─────────────────────────────┘                     │   └─ threads ────────────────┼──► Postgres (Neon)
                                                    └──────────────────────────────┘
```

1. The **frontend** (`javelin/`) is a Stripe Apps UI extension rendered in the Dashboard drawer. It signs every backend request with `fetchStripeSignature()`.
2. The **backend** (`javelin-backend/`) is a Next.js app (deployed on Vercel). It verifies the signature, which also tells it which Stripe account is asking.
3. Claude answers by calling tools. Each tool fetches from the Stripe API **on behalf of that account** (`{ stripeAccount }`) and returns deterministic results the model narrates.
4. Conversations (threads) are persisted in Postgres so merchants can return to them.

## Repository layout

| Path | What's there |
|---|---|
| [`javelin/`](javelin/) | Stripe App frontend: manifest (`stripe-app.json`), React views, streaming client |
| [`javelin-backend/app/api/`](javelin-backend/app/api/) | API routes: `ask` (streaming Q&A), `threads/{list,get,delete}`, `health/db` |
| [`javelin-backend/lib/ask/`](javelin-backend/lib/ask/) | System prompt, few-shot examples, Stripe fetchers, and the 30 tools (`tools/`) |
| [`javelin-backend/lib/metrics/`](javelin-backend/lib/metrics/) | Pure metric computations (MRR, churn, LTV, …) with unit tests |
| [`javelin-backend/lib/profile/`](javelin-backend/lib/profile/) | Per-merchant business profile (catalog, currency) cached in the Stripe Secret Store |
| [`javelin-backend/lib/auth/`](javelin-backend/lib/auth/) | Stripe App request-signature verification |
| [`javelin-backend/db/schema.sql`](javelin-backend/db/schema.sql) | Postgres schema for threads and messages |
| [`javelin-backend/evals/`](javelin-backend/evals/) | End-to-end eval harness (real model, mocked Stripe fixtures) |
| [`Build plan/metric-definitions.md`](Build%20plan/metric-definitions.md) | How every metric is defined and which Stripe source it follows |

## Running your own copy

You'll need: a Stripe account, Node.js 20+, the [Stripe CLI](https://docs.stripe.com/stripe-cli) with the Apps plugin (`stripe plugin install apps`), an [Anthropic API key](https://console.anthropic.com), a Postgres database (the project uses [Neon](https://neon.tech)'s free tier), and somewhere to host a Next.js app (the project uses [Vercel](https://vercel.com)).

### 1. Backend

```bash
cd javelin-backend
npm install
```

Create the database tables by running [`db/schema.sql`](javelin-backend/db/schema.sql) against your Postgres database (it's idempotent).

Set these environment variables (in `.env.local` for local dev, and in your host's settings for production):

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Your Stripe App's platform secret key. Used with `stripeAccount` to read each installing merchant's data. |
| `STRIPE_APP_SIGNING_SECRET` | The app's signing secret (`whsec_…`), from Dashboard → Apps → your app → ⋯ → Signing secret. See [`javelin-backend/README.md`](javelin-backend/README.md). |
| `ANTHROPIC_API_KEY` | Anthropic API key. Answers use `claude-sonnet-4-6`; thread titles use `claude-haiku-4-5`. |
| `DATABASE_URL` | Postgres connection string (`JAVELIN_THREADS_CONNECTION_STRING` is also accepted). |

Then run locally with `npm run dev`, or deploy (e.g. `vercel --prod`).

### 2. Frontend (the Stripe App)

The app ID and backend URL are hard-coded for the original deployment. Before uploading your own copy, change:

- **`javelin/stripe-app.json`**: set `id` to an ID under your own namespace, and replace every `https://javelin-backend.vercel.app/...` entry in `connect-src` with your backend's URL.
- **`javelin/src/utils/api.ts`**: point the URL constants at your backend. (These must match `connect-src` exactly, or the Dashboard will block the request.)

The backend routes already send the CORS headers the Dashboard needs. If you add a new request header in the frontend, add it to that route's `Access-Control-Allow-Headers` too.

```bash
cd javelin
npm install
stripe apps start     # preview in your Dashboard (test mode)
stripe apps upload    # upload a version for installation
```

The manifest requests **read-only** permissions (customers, invoices, subscriptions, charges, payouts, balance, and similar). Javelin never writes to Stripe.

## Tests and evals

```bash
cd javelin-backend && npm test   # ~750 unit tests (Vitest), no network
cd javelin && npm test           # frontend unit tests (Jest)
```

The eval harness runs real questions through the real model against fixture data, and grades which tools were called and what the answer says. It calls the Anthropic API and costs roughly $2 per full run, so it's opt-in:

```bash
cd javelin-backend && npm run evals
```

## Status

Javelin is an early-stage project, built and tested against a small number of real merchant accounts. Known limitations:

- Single Stripe mode per deployment (live *or* test, set by `STRIPE_SECRET_KEY`).
- Large accounts can make the first question slow, because some metrics page through full charge and invoice history.
- Projections (`project_revenue`, `goal_eta`, …) use Javelin-defined methods, since Stripe publishes no canonical forecasting method; their outputs carry a `javelin_defined.*` definition tag.

## License

[MIT](LICENSE)
