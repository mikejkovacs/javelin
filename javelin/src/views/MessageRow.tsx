import {
  Badge,
  Box,
  Button,
  Icon,
  Inline,
  Tooltip,
} from '@stripe/ui-extension-sdk/ui';
import type { Message } from '../state/threadReducer';
import { copyToClipboard } from '../utils/clipboard';
import { citationLabelForTool } from '../utils/citationLabels';
import { parseAnswer, type Segment, type Span } from '../utils/parseAnswer';
import { descriptionForTool } from '../utils/toolDescriptions';

interface MessageRowProps {
  message: Message;
  /** True when this is the last message AND the stream is still in flight.
   *  Suppresses Copy + Sources affordances so operator can't click Copy on
   *  a partial answer. Defaults to false (affordances always show). */
  isLastWhileStreaming?: boolean;
}

/** Render a span list as inline text. Each span is an `<Inline>` so bold
 *  emphasis flows alongside the surrounding text — using `<Box>` for spans
 *  forces line breaks because Box is block-level inside the SDK. */
function renderSpans(spans: Span[]) {
  return (
    <>
      {spans.map((s, i) =>
        s.bold ? (
          <Inline key={i} css={{ fontWeight: 'bold' }}>
            {s.text}
          </Inline>
        ) : (
          <Inline key={i}>{s.text}</Inline>
        ),
      )}
    </>
  );
}

/** Render parser output. Paragraphs render as body-text Boxes; bullets
 *  render as a horizontal Box with a • glyph + content column that wraps. */
function RenderedAnswer({ content }: { content: string }) {
  const segments = parseAnswer(content);
  return (
    <Box css={{ stack: 'y', gapY: 'xsmall' }}>
      {segments.map((seg: Segment, i: number) =>
        seg.kind === 'bullet' ? (
          <Box
            key={i}
            css={{ stack: 'x', gapX: 'xsmall', alignY: 'top' }}
          >
            <Box css={{ fontWeight: 'bold' }}>•</Box>
            <Box css={{ width: 'fill', font: 'body' }}>
              {renderSpans(seg.spans)}
            </Box>
          </Box>
        ) : (
          <Box key={i} css={{ font: 'body' }}>
            {renderSpans(seg.spans)}
          </Box>
        ),
      )}
    </Box>
  );
}

/**
 * Renders a single message in the conversation. Asymmetric chat layout:
 * user messages render as a right-aligned, container-tinted, rounded
 * bubble that grows up to ~83% drawer width; assistant messages render
 * unwrapped (no background), filling the drawer. Assistant messages with
 * content get affordances below — Copy button on its own row, then a
 * ChipList of source tools (each chip's Tooltip reveals what that tool
 * measures). Both branches parse content for `**bold**` + `- ` bullets
 * via parseAnswer; user questions typically pass through the paragraph-
 * only path.
 */
export function MessageRow({
  message,
  isLastWhileStreaming = false,
}: MessageRowProps) {
  const isAssistant = message.role === 'assistant';
  const showAffordances =
    isAssistant && message.content.length > 0 && !isLastWhileStreaming;

  if (!isAssistant) {
    return (
      <Box css={{ stack: 'x', alignX: 'end' }}>
        <Box
          css={{
            backgroundColor: 'container',
            borderRadius: 'rounded',
            paddingX: 'medium',
            paddingY: 'small',
            width: 'fit',
            maxWidth: '5/6',
          }}
        >
          <RenderedAnswer content={message.content} />
        </Box>
      </Box>
    );
  }

  return (
    <Box css={{ padding: 'small' }}>
      <RenderedAnswer content={message.content} />

      {showAffordances && (
        <Box css={{ stack: 'y', gapY: 'xsmall', marginTop: 'small' }}>
          <Box css={{ stack: 'x', gapX: 'small', alignY: 'center' }}>
            <Button
              type="secondary"
              onPress={() => {
                void copyToClipboard(message.content);
              }}
            >
              <Icon name="clipboard" size="small" />
            </Button>
            {message.toolsUsed && message.toolsUsed.length > 0 && (
              <Box css={{ font: 'caption', color: 'secondary' }}>
                Sources:
              </Box>
            )}
          </Box>
          {message.toolsUsed && message.toolsUsed.length > 0 && (
            // Inline-flow row so badges pack-left and wrap like words.
            // A Box with stack:'x' + wrap:'wrap' space-between-distributes
            // (SDK quirk that ignores `distribute:'packed'`); inline-flow
            // sidesteps that — each badge wrapped in <Inline> with a small
            // right margin renders like inline-block text, flowing L→R
            // and wrapping to a new line when the parent runs out of width.
            <Box>
              {message.toolsUsed.map((toolName, i) => (
                <Inline
                  key={i}
                  css={{ marginRight: 'xsmall' }}
                >
                  <Tooltip
                    trigger={
                      <Badge type="neutral">
                        {citationLabelForTool(toolName)}
                      </Badge>
                    }
                  >
                    {descriptionForTool(toolName)}
                  </Tooltip>
                </Inline>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
