// scripts/cache-marker-spike.test.ts
//
// V3 cache verification — runs the REAL V3 system prompt (built via
// buildSystemPrompt) against Anthropic and confirms caching engages.
//
// Cold run: cache_creation_input_tokens > 4096 on call 1.
// Warm run: cache_read_input_tokens > 4096 on call 1.
//
// This is the canonical re-verification tool when:
//   - Anthropic moves the Haiku 4.5 cache threshold
//   - The V3 system prompt changes (rules, padding, tools)
//   - The L1+L2 profile envelope shape changes
//
// Run: RUN_CACHE_SPIKE=1 npx vitest run scripts/cache-marker-spike.test.ts --reporter=verbose

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vite/Vitest skips .env.local in test mode by design; load it manually.
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envLocal = readFileSync(
    resolve(__dirname, '..', '.env.local'),
    'utf8',
  );
  const match = envLocal.match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (match) process.env.ANTHROPIC_API_KEY = match[1].trim();
} catch {
  /* fall back to whatever env is set */
}

// Some shells (e.g., Claude Desktop) export ANTHROPIC_BASE_URL pointing at a
// proxy without /v1. Clear it so the provider falls back to its own default.
delete process.env.ANTHROPIC_BASE_URL;

import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, stepCountIs } from 'ai';
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../lib/ask/systemPrompt';
import { FIXTURE_PROFILE } from '../evals/profileFixture';

const anthropic = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

describe.runIf(process.env.RUN_CACHE_SPIKE)('V3 cache verification', () => {
  it('engages caching with the real V3 system prompt + populated profile', async () => {
    const systemPrompt = buildSystemPrompt(FIXTURE_PROFILE);
    console.log(`\n[spike] V3 system prompt: ${systemPrompt.length} chars`);

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      messages: [
        {
          role: 'system',
          content: systemPrompt,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        },
        {
          role: 'user',
          content: 'Just respond with "ok" — this is a cache test.',
        },
      ],
      stopWhen: stepCountIs(1),
    });

    for await (const _ of result.textStream) {
      /* drain */
    }

    const steps = await result.steps;
    console.log(`[spike] total steps: ${steps.length}`);
    for (const [i, step] of steps.entries()) {
      const meta = (step.providerMetadata?.anthropic as
        | { usage?: { cache_creation_input_tokens?: number; cache_read_input_tokens?: number; input_tokens?: number } }
        | undefined)?.usage;
      console.log(`[spike] --- step ${i + 1} ---`);
      console.log(`[spike]   input_tokens (uncached):       ${meta?.input_tokens}`);
      console.log(`[spike]   cache_creation_input_tokens:  ${meta?.cache_creation_input_tokens}`);
      console.log(`[spike]   cache_read_input_tokens:      ${meta?.cache_read_input_tokens}`);
      console.log(`[spike]   finishReason: ${step.finishReason}`);
    }

    // Cache must engage: either we wrote (cold) or read (warm) > 4096 tokens.
    const meta = (steps[0].providerMetadata?.anthropic as
      | { usage?: { cache_creation_input_tokens?: number; cache_read_input_tokens?: number } }
      | undefined)?.usage;
    const created = meta?.cache_creation_input_tokens ?? 0;
    const read = meta?.cache_read_input_tokens ?? 0;
    console.log(`\n[spike] cache engagement: created=${created} read=${read} (need created+read > 4096)`);
    expect(created + read).toBeGreaterThan(4096);
  }, 60_000);
});
