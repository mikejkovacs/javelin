import type { Profile } from '../profile/types';
import { injectProfile, PROFILE_INJECTION_PROMPT_RULES } from '../profile';
import { PORTED_RULES } from './portedRules';
import { TOOL_USE_MECHANICS } from './toolUseMechanics';
import { FEW_SHOT_EXAMPLES } from './fewShotExamples';

// Assembles the V3 stable-prefix system prompt:
//   PORTED_RULES → TOOL_USE_MECHANICS → PROFILE_INJECTION_PROMPT_RULES
//   → injectProfile(profile) → FEW_SHOT_EXAMPLES
// Empty sections are filtered (e.g. profile=null on first-open / cold cache).
export function buildSystemPrompt(profile: Profile | null): string {
  const sections = [
    PORTED_RULES,
    TOOL_USE_MECHANICS,
    PROFILE_INJECTION_PROMPT_RULES,
    injectProfile(profile),
    FEW_SHOT_EXAMPLES,
  ];
  return sections.filter((s) => s.trim().length > 0).join('\n\n');
}
