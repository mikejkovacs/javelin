/**
 * Tool-name → citation label transform for the per-message "Sources: ..."
 * caption below assistant messages.
 *
 * Approach: auto-format the raw `tool_name` from snake_case into a sentence-
 * case label (`period_billed_revenue` → `Period billed revenue`). Acronyms
 * are uppercased explicitly so they don't get sentence-cased into nonsense
 * (`mrr` → `MRR`, not `Mrr`; `goal_eta` → `Goal ETA`, not `Goal eta`).
 *
 * Why auto-format vs. a hand-curated registry: the registry approach
 * (previous implementation) flattened tool-specific qualifiers into overly
 * generic labels (`period_billed_revenue` → `Billed revenue` lost the
 * "period" context). Auto-format preserves the original tool name's
 * specificity while making it readable. Trade-off: tools with verb-leading
 * names like `project_revenue` read as imperatives ("Project revenue")
 * rather than the intended noun phrase ("Revenue projection") — acceptable
 * for v1; rename the tool itself if it becomes confusing.
 */

/** Tokens that should always render in uppercase regardless of position. */
const ACRONYMS = new Set([
  'mrr',
  'arr',
  'eta',
  'api',
  'usd',
  'cad',
  'eur',
  'gbp',
]);

export function citationLabelForTool(toolName: string): string {
  const words = toolName.split('_');
  const formatted = words.map((word, i) => {
    if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
    if (i === 0) return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
  });
  return formatted.join(' ');
}
