import Stripe from 'stripe';
import type { NextRequest } from 'next/server';

/** Stripe-attested identity from a verified signed request. */
export type VerifiedRequest = {
  /**
   * Optional per Stripe Apps spec: contexts without an authenticated user
   * may sign requests with only an account_id. account_id is what carries
   * authentication weight; user_id is audit metadata when available.
   */
  userId: string | undefined;
  accountId: string;
  /**
   * The already-parsed body. Returned so route handlers don't have to
   * re-read req.json() (the stream is consumed here).
   */
  body: Record<string, unknown>;
};

export type VerificationFailureReason =
  | 'missing_signature_header'
  | 'invalid_body'
  | 'missing_account_id'
  | 'verification_failed';

export class SignatureVerificationError extends Error {
  constructor(
    public readonly reason: VerificationFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'SignatureVerificationError';
  }
}

// 5-minute skew tolerance per Item 1 plan.
const TOLERANCE_SECONDS = 300;

/**
 * Verify a request signed by `fetchStripeSignature` from a Stripe App
 * frontend. On success, returns the Stripe-attested account_id (use this
 * with `stripeAccount` on any downstream Stripe API call) and the parsed
 * body. On failure, throws SignatureVerificationError — callers should
 * return 401.
 *
 * Canonical signed payload (basic mode): JSON.stringify({user_id, account_id})
 * with that exact field order. Anything else in the body is NOT bound to
 * the signature — accepted trade-off in Item 1.
 *
 * Edge-runtime safe via verifyHeaderAsync + SubtleCrypto provider.
 */
export async function verifyAndGetAccountId(
  req: NextRequest,
): Promise<VerifiedRequest> {
  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    throw new SignatureVerificationError(
      'missing_signature_header',
      'Stripe-Signature header is missing',
    );
  }

  const secret = process.env.STRIPE_APP_SIGNING_SECRET;
  if (!secret) {
    // Misconfiguration — surface as a hard 500, not a 401.
    throw new Error('STRIPE_APP_SIGNING_SECRET is not configured');
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    throw new SignatureVerificationError(
      'invalid_body',
      'Request body is not valid JSON',
    );
  }

  const rawUserId = body.user_id;
  const accountId = body.account_id;

  // user_id is optional (Stripe Apps spec). Coerce to string-or-undefined;
  // anything else is treated as absent so the canonical mirrors the
  // frontend's JSON.stringify (which drops undefined).
  const userId = typeof rawUserId === 'string' ? rawUserId : undefined;

  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new SignatureVerificationError(
      'missing_account_id',
      'Request body is missing account_id',
    );
  }

  // Stripe Apps spec: user_id MUST precede account_id when present.
  // JSON.stringify preserves insertion order and drops undefined values,
  // so this matches the frontend's canonical form whether user_id is set
  // or absent.
  const canonicalPayload = JSON.stringify({
    user_id: userId,
    account_id: accountId,
  });

  // Instantiate only to access webhooks.signature — we never make API
  // calls from this helper. Constructor doesn't network.
  const stripe = new Stripe(secret);
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  try {
    await stripe.webhooks.signature.verifyHeaderAsync(
      canonicalPayload,
      sig,
      secret,
      TOLERANCE_SECONDS,
      cryptoProvider,
    );
  } catch (err) {
    throw new SignatureVerificationError(
      'verification_failed',
      err instanceof Error ? err.message : 'Signature verification failed',
    );
  }

  return { userId, accountId, body };
}
