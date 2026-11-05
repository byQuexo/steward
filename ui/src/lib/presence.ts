// Steward's presence: one character that shows what the assistant is doing (DESIGN.md §7).
// A small, pure state machine over the latest turn plus composer / voice / session state, so it
// is easy to test. The component (components/presence.tsx) only renders what this returns and
// keeps the timers of the short "flash" states.

import type { OrbState } from 'thinking-orbs';

import type { MessageKey } from '@/i18n';

import { agentRole, type Turn } from './timeline';
import type { KillMode } from './types';

export type PresenceState =
  | 'idle'
  | 'typing'
  | 'listening'
  | 'thinking'
  | 'calling_tools'
  | 'composing'
  | 'awaiting_approval'
  | 'denied'
  | 'approved'
  | 'done'
  | 'error'
  | 'paused';

/** Short-lived reactions to a single event. */
export type Flash = 'denied' | 'approved' | 'done';

/** How long a flash state is shown, in ms. */
export const FLASH_MS: Record<Flash, number> = { denied: 800, approved: 1200, done: 1200 };

export type Verdict = 'allow' | 'approval' | 'deny';

export interface PresenceInput {
  /** The latest turn of the conversation (if any). */
  turn?: Turn;
  /** The composer has text and focus. */
  typing?: boolean;
  /** Voice push-to-talk is held. */
  listening?: boolean;
  /** Admin test session ("test as"): Steward sees through someone else's eyes. */
  testAs?: boolean;
  kill?: KillMode;
  /** A flash detected by `detectFlash` that has not expired yet. */
  flash?: Flash | null;
}

export interface Companion {
  role: 'research' | 'action';
  agent: string;
  working: boolean;
}

export interface Presence {
  state: PresenceState;
  /** `bot-avatars` state. */
  avatar: 'default' | 'working' | 'sleeping';
  /** `thinking-orbs` halo, or none. */
  orb: OrbState | null;
  /** Verdict rim around the body (color means Warden decided). */
  rim: Verdict | null;
  /** Held head orientation (radians): toward the composer or the approval card. */
  pose?: { yaw: number; pitch: number };
  gesture: 'shake' | 'hop' | 'nod' | null;
  glasses: boolean;
  headphones: boolean;
  dimmed: boolean;
  /** Freeze the body (kill switch). */
  frozen: boolean;
  /** Sub-agent budded off by an A2A handoff in the running turn. */
  companion: Companion | null;
  label: MessageKey;
}

const running = (turn?: Turn) => turn?.status === 'streaming';

function pendingApproval(turn: Turn): boolean {
  return turn.items.some((x) => x.kind === 'approval' && x.status === 'pending');
}

function toolInFlight(turn: Turn): boolean {
  return turn.items.some((x) => x.kind === 'tool' && !x.result && x.decision?.effect !== 'deny');
}

function failed(turn: Turn): boolean {
  return turn.status === 'error' || turn.items.some((x) => x.kind === 'budget' || x.kind === 'error');
}

/** The sub-agent currently working for Steward: the last handoff, until Steward acts again. */
export function companionOf(turn?: Turn): Companion | null {
  if (!turn || !running(turn)) return null;
  let last = -1;
  turn.items.forEach((x, i) => {
    if (x.kind === 'handoff') last = i;
  });
  if (last < 0) return null;
  const h = turn.items[last];
  if (h?.kind !== 'handoff' || h.decision?.effect === 'deny') return null;
  const role = agentRole(h.to);
  if (role !== 'research' && role !== 'action') return null;
  const back = turn.items.slice(last + 1).some((x) => x.kind === 'tool' && (!x.agent || agentRole(x.agent) === 'orchestrator'));
  if (back) return null;
  return { role, agent: h.to, working: true };
}

const decisions = (turn: Turn | undefined, effect: string) =>
  turn ? turn.items.filter((x) => (x.kind === 'tool' || x.kind === 'handoff') && x.decision?.effect === effect).length : 0;

const approvedCount = (turn: Turn | undefined) =>
  turn ? turn.items.filter((x) => x.kind === 'approval' && x.status === 'approved').length : 0;

/** A one-off reaction between two snapshots of the latest turn (denied > approved > done). */
export function detectFlash(prev: Turn | undefined, next: Turn | undefined): Flash | null {
  if (!next) return null;
  const before = prev && prev.id === next.id ? prev : undefined;
  if (decisions(next, 'deny') > decisions(before, 'deny')) return 'denied';
  if (approvedCount(next) > approvedCount(before)) return 'approved';
  if (before?.status === 'streaming' && next.status === 'done') return 'done';
  return null;
}

const LOOK_AT_COMPOSER = { yaw: 0.1, pitch: -0.38 };
const LOOK_AT_APPROVAL = { yaw: -0.32, pitch: 0.3 };

/** The presence for one snapshot. Priority: flash › listening › running › done › kill › typing › error › idle. */
export function derivePresence(input: PresenceInput): Presence {
  const { turn, typing = false, listening = false, testAs = false, kill = 'off', flash = null } = input;
  const base: Presence = {
    state: 'idle',
    avatar: 'default',
    orb: null,
    rim: null,
    gesture: null,
    glasses: testAs,
    headphones: false,
    dimmed: kill !== 'off',
    frozen: false,
    companion: companionOf(turn),
    label: 'presence.idle',
  };
  const is = (state: PresenceState, extra: Partial<Presence>): Presence => ({ ...base, state, label: `presence.${state}` as MessageKey, ...extra });

  if (flash === 'denied') return is('denied', { rim: 'deny', gesture: 'shake' });
  if (flash === 'approved') return is('approved', { rim: 'allow', gesture: 'hop' });
  if (listening) return is('listening', { headphones: true, orb: 'listening' });
  if (turn && running(turn)) {
    if (pendingApproval(turn)) return is('awaiting_approval', { orb: 'breathing', rim: 'approval', pose: LOOK_AT_APPROVAL });
    if (toolInFlight(turn)) return is('calling_tools', { avatar: 'working', orb: 'searching' });
    if (turn.answer) return is('composing', { avatar: 'working', orb: 'composing' });
    return is('thinking', { avatar: 'working', orb: 'solving' });
  }
  if (flash === 'done') return is('done', { gesture: 'nod' });
  if (kill !== 'off') return is('paused', { avatar: 'sleeping', frozen: true });
  if (typing) return is('typing', { pose: LOOK_AT_COMPOSER });
  if (turn && failed(turn)) return is('error', { avatar: 'sleeping' });
  return base;
}
