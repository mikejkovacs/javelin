import { neon } from '@neondatabase/serverless';

// Stripe Projects writes the Neon connection string to local `.env` as
// `JAVELIN_THREADS_CONNECTION_STRING`. We mirror it to Vercel production env
// as `DATABASE_URL` (the canonical name). This fallback chain lets the same
// code run in both environments without local `.env` edits.
const connectionString =
  process.env.DATABASE_URL ?? process.env.JAVELIN_THREADS_CONNECTION_STRING;

if (!connectionString) {
  throw new Error(
    '[db] No connection string found. Set DATABASE_URL (production) or JAVELIN_THREADS_CONNECTION_STRING (local).',
  );
}

// Edge-runtime-compatible Neon client. Tagged-template SQL with built-in
// parameterization — no manual escaping needed.
//
// Usage: const rows = await sql`SELECT * FROM threads WHERE account_id = ${id}`;
export const sql = neon(connectionString);
