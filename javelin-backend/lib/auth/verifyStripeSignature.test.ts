import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Stripe from 'stripe';
import { NextRequest } from 'next/server';
import {
  verifyAndGetAccountId,
  SignatureVerificationError,
} from './verifyStripeSignature';

const SECRET = 'whsec_test_javelin_signing_secret_xxxxxxxxxxxx';
const USER_ID = 'usr_test_123';
const ACCOUNT_ID = 'acct_test_456';

/** Build a signed NextRequest. Override headers/body/secret/timestamp to
 *  exercise specific failure modes. */
function buildRequest(opts: {
  body?: Record<string, unknown> | string;
  signWithBody?: Record<string, unknown>;
  signWithSecret?: string;
  timestamp?: number;
  signatureHeader?: string | null;
} = {}): NextRequest {
  const body =
    opts.body === undefined
      ? { user_id: USER_ID, account_id: ACCOUNT_ID }
      : opts.body;
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body);

  const signedObject =
    opts.signWithBody ??
    (typeof body === 'object' && body !== null
      ? { user_id: (body as Record<string, unknown>).user_id, account_id: (body as Record<string, unknown>).account_id }
      : { user_id: USER_ID, account_id: ACCOUNT_ID });
  const signedPayload = JSON.stringify(signedObject);

  let sig: string | null;
  if (opts.signatureHeader === null) {
    sig = null;
  } else if (opts.signatureHeader !== undefined) {
    sig = opts.signatureHeader;
  } else {
    sig = Stripe.webhooks.generateTestHeaderString({
      payload: signedPayload,
      secret: opts.signWithSecret ?? SECRET,
      timestamp: opts.timestamp,
    });
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (sig !== null) headers.set('Stripe-Signature', sig);

  return new NextRequest('http://test.local/api/chat', {
    method: 'POST',
    headers,
    body: bodyString,
  });
}

describe('verifyAndGetAccountId', () => {
  beforeEach(() => {
    process.env.STRIPE_APP_SIGNING_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.STRIPE_APP_SIGNING_SECRET;
  });

  it('returns userId, accountId, and parsed body on a valid signed request', async () => {
    const req = buildRequest({
      body: { user_id: USER_ID, account_id: ACCOUNT_ID, question: 'What is my MRR?' },
    });
    const result = await verifyAndGetAccountId(req);
    expect(result.userId).toBe(USER_ID);
    expect(result.accountId).toBe(ACCOUNT_ID);
    expect(result.body).toMatchObject({
      user_id: USER_ID,
      account_id: ACCOUNT_ID,
      question: 'What is my MRR?',
    });
  });

  it('throws missing_signature_header when Stripe-Signature is absent', async () => {
    const req = buildRequest({ signatureHeader: null });
    await expect(verifyAndGetAccountId(req)).rejects.toMatchObject({
      name: 'SignatureVerificationError',
      reason: 'missing_signature_header',
    });
  });

  it('throws invalid_body when the body is not valid JSON', async () => {
    const req = buildRequest({ body: 'this-is-not-json{' });
    await expect(verifyAndGetAccountId(req)).rejects.toMatchObject({
      name: 'SignatureVerificationError',
      reason: 'invalid_body',
    });
  });

  it('verifies successfully when user_id is absent (account-only signing per Stripe Apps spec)', async () => {
    const req = buildRequest({
      body: { account_id: ACCOUNT_ID },
      signWithBody: { account_id: ACCOUNT_ID },
    });
    const result = await verifyAndGetAccountId(req);
    expect(result.userId).toBeUndefined();
    expect(result.accountId).toBe(ACCOUNT_ID);
  });

  it('throws verification_failed when body claims no user_id but signature was over a body with user_id', async () => {
    // Demonstrates the canonical-mirror property: dropping user_id from the
    // body must also drop it from the signed payload — otherwise mismatch.
    const req = buildRequest({
      body: { account_id: ACCOUNT_ID },
      signWithBody: { user_id: USER_ID, account_id: ACCOUNT_ID },
    });
    await expect(verifyAndGetAccountId(req)).rejects.toMatchObject({
      name: 'SignatureVerificationError',
      reason: 'verification_failed',
    });
  });

  it('throws missing_account_id when body lacks account_id', async () => {
    const req = buildRequest({
      body: { user_id: USER_ID },
      signWithBody: { user_id: USER_ID, account_id: ACCOUNT_ID },
    });
    await expect(verifyAndGetAccountId(req)).rejects.toMatchObject({
      name: 'SignatureVerificationError',
      reason: 'missing_account_id',
    });
  });

  it('throws verification_failed when account_id was tampered with after signing', async () => {
    const req = buildRequest({
      body: { user_id: USER_ID, account_id: 'acct_tampered_999' },
      signWithBody: { user_id: USER_ID, account_id: ACCOUNT_ID },
    });
    await expect(verifyAndGetAccountId(req)).rejects.toMatchObject({
      name: 'SignatureVerificationError',
      reason: 'verification_failed',
    });
  });

  it('throws verification_failed when the timestamp is outside the 5-min tolerance', async () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    const req = buildRequest({ timestamp: tenMinutesAgo });
    await expect(verifyAndGetAccountId(req)).rejects.toMatchObject({
      name: 'SignatureVerificationError',
      reason: 'verification_failed',
    });
  });

  it('throws verification_failed when signed with a different secret', async () => {
    const req = buildRequest({ signWithSecret: 'whsec_wrong_secret_aaaaaaaaaaaa' });
    await expect(verifyAndGetAccountId(req)).rejects.toMatchObject({
      name: 'SignatureVerificationError',
      reason: 'verification_failed',
    });
  });

  it('throws verification_failed on a malformed Stripe-Signature header', async () => {
    const req = buildRequest({ signatureHeader: 'garbage-not-a-real-signature' });
    await expect(verifyAndGetAccountId(req)).rejects.toMatchObject({
      name: 'SignatureVerificationError',
      reason: 'verification_failed',
    });
  });

  it('throws a plain Error (not SignatureVerificationError) when the env var is missing', async () => {
    delete process.env.STRIPE_APP_SIGNING_SECRET;
    const req = buildRequest();
    await expect(verifyAndGetAccountId(req)).rejects.toThrow(
      'STRIPE_APP_SIGNING_SECRET is not configured',
    );
    await expect(verifyAndGetAccountId(req)).rejects.not.toBeInstanceOf(
      SignatureVerificationError,
    );
  });
});
