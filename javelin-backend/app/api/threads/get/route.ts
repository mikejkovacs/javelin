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
      console.error('[auth] /api/threads/get verification failed:', err.reason);
      return Response.json(
        { error: 'unauthorized' },
        { status: 401, headers: corsHeaders },
      );
    }
    console.error('[auth] /api/threads/get internal error:', err);
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
    const [thread] = await sql`
      SELECT thread_id, title, created_at, last_active_at
      FROM threads
      WHERE thread_id = ${threadId}
        AND account_id = ${verified.accountId}
        AND deleted_at IS NULL
    `;
    if (!thread) {
      return Response.json(
        { error: 'not_found' },
        { status: 404, headers: corsHeaders },
      );
    }
    const messages = await sql`
      SELECT message_id, role, content, tool_calls, created_at
      FROM messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC
    `;
    return Response.json(
      { thread, messages },
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error('[threads/get] query failed:', err);
    return Response.json(
      { error: 'internal_error' },
      { status: 500, headers: corsHeaders },
    );
  }
}
