This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Setup

### Required environment variable

`STRIPE_APP_SIGNING_SECRET` — the signing secret for the Javelin Stripe App. The backend uses this to verify that incoming requests originate from the Javelin sidebar (see [`lib/auth/verifyStripeSignature.ts`](lib/auth/verifyStripeSignature.ts)). Requests without a valid signature are rejected with 401.

**Obtain the secret:**

1. Go to the [Stripe Dashboard](https://dashboard.stripe.com/) → **Apps**.
2. Select **Javelin** from your app list.
3. Click the overflow menu (⋯) under the application ID.
4. Click **Signing secret**.
5. Copy the value (starts with `whsec_`).

**Set the secret:**

- **Local development:** add to `.env.local` in this directory:
  ```
  STRIPE_APP_SIGNING_SECRET=whsec_...
  ```
- **Production (Vercel):** Project Settings → Environment Variables → add `STRIPE_APP_SIGNING_SECRET` for the Production environment. Redeploy after adding — Vercel only injects new env vars on fresh deploys.

If the variable is missing at runtime, both `/api/chat` and `/api/plan` return HTTP 500 with body `{"error":"internal_error"}` and log `STRIPE_APP_SIGNING_SECRET is not configured` to Vercel logs.

### Tolerance

Signed requests must arrive within 5 minutes (300 seconds) of Stripe's signing timestamp. Beyond that, the backend rejects them as `verification_failed`. This protects against replay of captured requests.

### Rotation

To rotate the signing secret: generate a new one in the Stripe Dashboard (same path as above), update `STRIPE_APP_SIGNING_SECRET` in Vercel, and redeploy. In-flight requests signed with the old secret will fail verification during the cutover window — schedule rotations during low-traffic periods. Confirm Stripe's current rotation guidance before rotating in production; overlap-window behavior may differ across Stripe Apps SDK versions.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
