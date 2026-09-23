import { Box } from '@stripe/ui-extension-sdk/ui';
import type { Message } from '../state/threadReducer';
import { MessageRow } from './MessageRow';

/**
 * Renders the active thread's message list. Stateless — receives the
 * messages array, maps to MessageRow per element. Used in App.tsx when
 * messages.length > 0; EmptyState renders otherwise.
 *
 * `isStreaming` flows through from App.tsx (state.stage === 'streaming').
 * For the LAST message during an in-flight stream, MessageRow suppresses
 * the Copy + Sources affordances — they appear only once the answer is
 * fully streamed. Prevents operator from clicking Copy mid-stream and
 * getting a partial answer.
 */
export function ConversationView({
  messages,
  isStreaming,
}: {
  messages: Message[];
  isStreaming: boolean;
}) {
  return (
    <Box css={{ stack: 'y', gapY: 'small' }}>
      {messages.map((msg, i) => (
        <MessageRow
          key={i}
          message={msg}
          isLastWhileStreaming={i === messages.length - 1 && isStreaming}
        />
      ))}
    </Box>
  );
}
