import { clipboardWriteText } from '@stripe/ui-extension-sdk/clipboard';

/**
 * Copy text to the user's clipboard via Stripe Apps SDK's clipboard API.
 * Used by per-message Copy + Share affordances in MessageRow.
 */
export async function copyToClipboard(text: string): Promise<void> {
  await clipboardWriteText(text);
}
