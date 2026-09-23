/**
 * UUIDv4 generators for thread + message IDs. Stripe Apps iframe runs in
 * modern Chrome — crypto.randomUUID is available natively.
 *
 * Prefixes (`thr_`, `msg_`) aid log-grep across frontend + backend.
 * The DB schema (TEXT PRIMARY KEY) doesn't enforce a format, so the
 * prefix is convention only.
 */
export function newThreadId(): string {
  return `thr_${crypto.randomUUID()}`;
}

export function newMessageId(): string {
  return `msg_${crypto.randomUUID()}`;
}
