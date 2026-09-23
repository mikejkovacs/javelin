import { Box } from '@stripe/ui-extension-sdk/ui';

interface EmptyStateProps {
  businessName: string | null;
}

const EXAMPLE_QUESTIONS = [
  'How is my revenue trending?',
  "What's my customer concentration?",
  'Who are my top five customers?',
];

/**
 * Empty-state surface — shown when the active thread has no messages
 * (new conversation or before first send).
 *
 * Layout (centered vertical stack):
 *   ⚡  (font: 'title')
 *   Fast answers from {BusinessName}.   (font: 'subtitle', semibold)
 *   Ask anything about your business on Stripe.   (font: 'body', secondary)
 *   ──── (extra vertical gap)
 *   "How is my revenue trending?"          (light grey, quoted)
 *   "What's my customer concentration?"
 *   "Who are my top five customers?"
 *
 * The lead line uses the merchant business name when available; falls
 * back to "your business" otherwise.
 */
export function EmptyState({ businessName }: EmptyStateProps) {
  const subject = businessName ?? 'your business';
  const leadLine = `👋 ${subject}`;

  return (
    <Box
      css={{
        stack: 'y',
        alignX: 'center',
        gapY: 'small',
        marginY: 'xxlarge',
      }}
    >
      <Box
        css={{
          font: 'subtitle',
          fontWeight: 'semibold',
          textAlign: 'center',
        }}
      >
        {leadLine}
      </Box>
      <Box
        css={{ font: 'body', color: 'secondary', textAlign: 'center' }}
      >
        Ask anything about your business on Stripe.
      </Box>

      <Box
        css={{
          stack: 'y',
          alignX: 'center',
          gapY: 'xsmall',
          marginTop: 'xlarge',
        }}
      >
        {EXAMPLE_QUESTIONS.map((q) => (
          <Box
            key={q}
            css={{ font: 'body', color: 'disabled', textAlign: 'center' }}
          >
            {`"${q}"`}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
