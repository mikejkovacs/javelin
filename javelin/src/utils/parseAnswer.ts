// Tiny markdown parser for assistant message rendering. Supports exactly
// two markdown features — `- ` line-leading bullets and `**bold**` inline
// emphasis. Anything else is treated as literal text. Intentionally minimal:
// the LLM is constrained by the FORMAT rule to emit only these two shapes.
//
// Pure / synchronous; safe inside the Stripe Apps esbuild es2016 target
// (no async generators, no class privates).

export interface Span {
  bold: boolean;
  text: string;
}

export interface Segment {
  kind: 'paragraph' | 'bullet';
  spans: Span[];
}

/**
 * Parse a `**bold**`-aware single line into spans. Unclosed `**` is treated
 * as literal text (don't crash on partial mid-stream content).
 */
function parseSpans(line: string): Span[] {
  const spans: Span[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    const open = line.indexOf('**', cursor);
    if (open === -1) {
      spans.push({ bold: false, text: line.slice(cursor) });
      break;
    }
    if (open > cursor) {
      spans.push({ bold: false, text: line.slice(cursor, open) });
    }
    const close = line.indexOf('**', open + 2);
    if (close === -1) {
      // Unclosed — render the rest (including the opening **) as literal.
      spans.push({ bold: false, text: line.slice(open) });
      break;
    }
    spans.push({ bold: true, text: line.slice(open + 2, close) });
    cursor = close + 2;
  }
  return spans.filter((s) => s.text.length > 0);
}

/**
 * Split a content string into a list of segments. Lines starting with
 * `- ` become bullets (the `- ` prefix is stripped); other non-empty
 * lines become paragraphs. Empty lines are dropped.
 *
 * Pre-pass: substitutes em-dashes (`—`) for hyphens (`-`). Tightens the
 * visual ratio of the inline separator against bold labels in the bullet
 * pattern (`**Label** - description`) without changing the LLM-side
 * convention (system prompt still emits em-dashes; the substitution is
 * a render-time taste call).
 */
export function parseAnswer(content: string): Segment[] {
  const normalized = content.replace(/—/g, '-');
  const lines = normalized.split('\n');
  const segments: Segment[] = [];
  for (const raw of lines) {
    if (raw.length === 0) continue;
    if (raw.startsWith('- ')) {
      segments.push({ kind: 'bullet', spans: parseSpans(raw.slice(2)) });
    } else {
      segments.push({ kind: 'paragraph', spans: parseSpans(raw) });
    }
  }
  return segments;
}
