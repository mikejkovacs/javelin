import { sql } from '../../../../lib/db';

export const runtime = 'edge';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}

export async function GET() {
  try {
    const rows = await sql`SELECT count(*) as thread_count FROM threads`;
    return Response.json(
      { status: 'ok', thread_count: rows[0]?.thread_count ?? 0 },
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    return Response.json(
      { status: 'error', error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: corsHeaders },
    );
  }
}
