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
      console.error('[auth] /api/threads/list verification failed:', err.reason);
      return Response.json(
        { error: 'unauthorized' },
        { status: 401, headers: corsHeaders },
      );
    }
    console.error('[auth] /api/threads/list internal error:', err);
    return Response.json(
      { error: 'internal_error' },
      { status: 500, headers: corsHeaders },
    );
  }

  try {
    const threads = await sql`
      SELECT thread_id, title, created_at, last_active_at
      FROM threads
      WHERE account_id = ${verified.accountId}
        AND deleted_at IS NULL
      ORDER BY last_active_at DESC
      LIMIT 50
    `;
    return Response.json(
      { threads },
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error('[threads/list] query failed:', err);
    return Response.json(
      { error: 'internal_error' },
      { status: 500, headers: corsHeaders },
    );
  }
}
