import { fetchStripeSignature } from '@stripe/ui-extension-sdk/utils';
import type { ExtensionContextValue } from '@stripe/ui-extension-sdk/context';

type UserContext = ExtensionContextValue['userContext'];

export type SignedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Create a fetch wrapper for the Javelin backend. Adds a Stripe App
 * signature header and injects user_id + account_id into the JSON body
 * per the Stripe Apps signed-request spec. Pass userContext once at the
 * App level; reuse the returned function for every backend call.
 *
 * Caller contract: init.body, when present, must be a JSON string. The
 * wrapper parses it, merges in user_id + account_id, and re-stringifies.
 *
 * user_id is included only when present on userContext (matches Stripe's
 * own SDK example, which uses optional chaining). The backend tolerates
 * absent user_id — see verifyStripeSignature.ts.
 */
export function createSignedFetch(userContext: UserContext): SignedFetch {
  return async (url, init) => {
    const baseBody =
      typeof init?.body === 'string' && init.body.length > 0
        ? JSON.parse(init.body)
        : {};
    const body = JSON.stringify({
      ...baseBody,
      user_id: userContext.id,
      account_id: userContext.account.id,
    });
    const signature = await fetchStripeSignature();
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        'Content-Type': 'application/json',
        'Stripe-Signature': signature,
      },
      body,
    });
  };
}
