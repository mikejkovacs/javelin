// Barrel export for the profile layer. Frontend + backend both import from here.
//
// Phase 1 ships:
//   - types (Profile, ProfileStore, isStale, schema version)
//   - buildProfile (pure builder)
//   - buildProfileFromStripe (Stripe-client adapter)
//   - createSecretStoreProfileStore (frontend-side impl, Phase 1)
//   - injectProfile (backend prompt-assembly — field formatting + thresholds)
//
// Phase 2 adds:
//   - createVercelKvProfileStore (backend-side impl)
//   - profile refresh cron + webhook handlers

export {
  PROFILE_SCHEMA_VERSION,
  isStale,
  type Profile,
  type ProfileStore,
  type StripeMode,
  type BusinessShape,
  type CatalogPlan,
  type MixRow,
} from './types';

export {
  buildProfile,
  buildProfileFromStripe,
  type BuildProfileInput,
  type BuildProfileDeps,
  type BuildProfileFromStripeInput,
} from './builder';

export { createSecretStoreProfileStore } from './secretStore';

export { injectProfile, PROFILE_INJECTION_PROMPT_RULES } from './inject';
