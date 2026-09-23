import { NextRequest } from 'next/server';
import {
  verifyAndGetAccountId,
  SignatureVerificationError,
} from '../../../../lib/auth';
import { sql } from '../../../../lib/db';

export const runtime = 'edge';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
};

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  let verified;
  try {
    verified = await verifyAndGetAccountId(req);
  } catch (err) {
    if (err instanceof SignatureVerificationError) {
      console.error('[auth] /api/threads/delete verification failed:', err.reason);
      return Response.json(
        { error: 'unauthorized' },
        { status: 401, headers: corsHeaders },
      );
    }
    console.error('[auth] /api/threads/delete internal error:', err);
    return Response.json(
      { error: 'internal_error' },
      { status: 500, headers: corsHeaders },
    );
  }

  const threadId = verified.body.thread_id;
  if (typeof threadId !== 'string' || threadId.length === 0) {
    return Response.json(
      { error: 'missing_thread_id' },
      { status: 400, headers: corsHeaders },
    );
  }

  try {
    const result = await sql`
      UPDATE threads
      SET deleted_at = NOW()
      WHERE thread_id = ${threadId}
        AND account_id = ${verified.accountId}
        AND deleted_at IS NULL
      RETURNING thread_id
    `;
    if (result.length === 0) {
      return Response.json(
        { error: 'not_found' },
        { status: 404, headers: corsHeaders },
      );
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  } catch (err) {
    console.error('[threads/delete] query failed:', err);
    return Response.json(
      { error: 'internal_error' },
      { status: 500, headers: corsHeaders },
    );
  }
}
