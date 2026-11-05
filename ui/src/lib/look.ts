// Visual constants shared by components (kept out of component files for fast refresh).

import type { BotAvatarType } from 'bot-avatars';

/** Ember, as hex for the canvas-based libraries (they do not read CSS variables). */
export const EMBER = { dark: '#f7a531', light: '#c4650a' } as const;

export type AgentRole = 'orchestrator' | 'research' | 'action';

/** One grey body per agent: Steward is the droid, its sub-agents a ghost and a mech. */
export const AGENT_LOOK: Record<AgentRole, { type: BotAvatarType; dark: string; light: string }> = {
  orchestrator: { type: 'droid', dark: '#ececec', light: '#262626' },
  research: { type: 'ghost', dark: '#a6a6a6', light: '#6e6e6e' },
  action: { type: 'mech', dark: '#727272', light: '#a8a8a8' },
};

export type VerdictTone = 'allow' | 'approval' | 'deny' | 'muted';

/** Warden effect → verdict tone (the only colors in the UI). */
export function effectTone(effect: string | undefined): VerdictTone {
  if (effect === 'allow') return 'allow';
  if (effect === 'require_approval') return 'approval';
  if (effect === 'deny') return 'deny';
  return 'muted';
}
