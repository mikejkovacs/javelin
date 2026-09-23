/**
 * Defensive cleanup for an LLM-generated thread title.
 *
 * Steps:
 *   1. Strip surrounding whitespace and surrounding quotes.
 *   2. If the cleaned text fits within `maxChars`, return as-is.
 *   3. Otherwise truncate to `maxChars`, but back off to the last word
 *      boundary if the cut would land mid-word (avoids "Collaps" instead
 *      of "Collapse").
 *
 * Pure / synchronous; isolated from DB and network so it's unit-testable
 * without a connection string in the environment.
 */
export function truncateTitle(text: string, maxChars: number): string {
  const cleaned = text.trim().replace(/^["']|["']$/g, '');
  if (cleaned.length <= maxChars) return cleaned;

  // We're truncating. Check whether the cut lands inside a word.
  const charAfterCut = cleaned[maxChars];
  if (/\s/.test(charAfterCut)) {
    // Slice ends at a word boundary already — return as-is.
    return cleaned.slice(0, maxChars).trimEnd();
  }

  // Slice lands mid-word. Back off to the last whitespace within the
  // slice; if no whitespace exists, fall back to the hard slice (better
  // a clipped word than an empty title).
  const slice = cleaned.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace <= 0) return slice;
  return slice.slice(0, lastSpace).trimEnd();
}
