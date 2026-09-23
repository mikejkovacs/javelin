// SecretStoreProfileStore — Phase 1 implementation of the ProfileStore
// interface, backed by Stripe's `apps.secrets` API.
//
// Scope: account (P1-S12) — one profile per Stripe account, shared across
// dashboard users. Per-user profiles arrive when Layer 3 lands.
//
// Mode scoping (P1-S7): the secret name embeds the mode (`live` or `test`)
// so `live` and `test` profiles never cross.
//
// Phase 2 swap path: this whole file gets replaced by `VercelKvProfileStore`
// when item 1 (backend auth) ships and the backend can derive merchant ID
// from authenticated context. The `ProfileStore` interface stays identical;
// consumer code (frontend bootstrap, backend injection) doesn't change.

import {
  PROFILE_SCHEMA_VERSION,
  type Profile,
  type ProfileStore,
  type StripeMode,
} from './types';

// Structural subset of the Stripe SDK's `apps.secrets` resource — just the
// methods we call. Keeping this local lets the backend stay free of the
// `stripe` npm package; the frontend's real `Stripe` client satisfies it
// structurally.
interface AppsSecretsLike {
  find(params: {
    name: string;
    scope: { type: 'account' | 'user'; user?: string };
    // Stripe does NOT return `payload` by default on find() — it must be
    // explicitly expanded. Without this, secret.payload is always undefined
    // and the cache silently misses on every read.
    expand?: Array<'payload'>;
  }): Promise<{ payload?: string | null }>;
  create(params: {
    name: string;
    payload: string;
    scope: { type: 'account' | 'user'; user?: string };
    expires_at?: number;
  }): Promise<unknown>;
}

export interface StripeAppsClientLike {
  apps: { secrets: AppsSecretsLike };
}

/** Secret name in `stripe.apps.secrets`. Versioned so a future schema bump
 *  can ship alongside a new key without colliding with the old shape. */
function secretName(mode: StripeMode): string {
  return `javelin_profile_${mode}_v${PROFILE_SCHEMA_VERSION}`;
}

/** Wraps a Stripe client so it satisfies the ProfileStore contract.
 *  `account` scope = the profile is shared across all dashboard users
 *  in this merchant's Stripe account. Stripe enforces cross-merchant
 *  isolation via the API-key boundary. */
export function createSecretStoreProfileStore(stripe: StripeAppsClientLike): ProfileStore {
  return {
    async read(mode: StripeMode): Promise<Profile | null> {
      try {
        const secret = await stripe.apps.secrets.find({
          name: secretName(mode),
          scope: { type: 'account' },
          // Stripe omits `payload` from find() responses unless explicitly
          // expanded. Without this, every read returns undefined → cache
          // miss → profile rebuilds on every sidebar open. (Diagnosed
          // 2026-04-23 against Merchant A live mode.)
          expand: ['payload'],
        });
        const payload = secret.payload;
        if (!payload) return null;
        const parsed = JSON.parse(payload) as Profile;
        // Version mismatch is treated as missing — caller will trigger a
        // rebuild, which writes a fresh v{PROFILE_SCHEMA_VERSION} payload.
        if (parsed.version !== PROFILE_SCHEMA_VERSION) return null;
        // Mode mismatch should never happen (key is mode-scoped) but defense
        // in depth: ignore any payload whose mode field disagrees.
        if (parsed.mode !== mode) return null;
        return parsed;
      } catch (err) {
        // Stripe returns 404 (resource_missing) when the secret hasn't been
        // set yet. Treat as "no profile" rather than a hard failure.
        const code = (err as { code?: string })?.code;
        const status = (err as { statusCode?: number })?.statusCode;
        if (code === 'resource_missing' || status === 404) return null;
        // Any other error: don't swallow silently — let the caller decide
        // whether to surface or proceed without grounding.
        throw err;
      }
    },

    async write(profile: Profile): Promise<void> {
      // `create` upserts by name+scope: if a secret with this name already
      // exists in this scope, Stripe replaces it. No separate update path.
      await stripe.apps.secrets.create({
        name: secretName(profile.mode),
        payload: JSON.stringify(profile),
        scope: { type: 'account' },
      });
    },
  };
}
