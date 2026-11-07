// Steward's presence: one character that shows what the assistant is doing (DESIGN.md §7).
// A small, pure state machine over the latest turn plus composer and session state, so it
// is easy to test. The component (components/presence.tsx) only renders what this returns and
// keeps the timers of the short "flash" states.

import type { OrbState } from 'thinking-orbs';

import type { MessageKey } from '@/i18n';

import { agentRole, type ToolItem, type Turn } from './timeline';
import type { KillMode } from './types';

export type PresenceState =
  | 'idle'
  | 'typing'
  | 'thinking'
  | 'calling_tools'
  | 'composing'
  | 'awaiting_approval'
  | 'denied'
  | 'approved'
  | 'done'
  | 'error'
  | 'paused'
  | 'dozing';

/** Short-lived reactions to a single event (`sent`: a nod when the user sends a message). */
export type Flash = 'denied' | 'approved' | 'done' | 'sent';

/** How long a flash is shown, in ms. */
export const FLASH_MS: Record<Flash, number> = { denied: 800, approved: 1200, done: 1200, sent: 700 };

/** Where Steward looks: at the composer, at the waiting gate, or at the user (the camera). */
export type Look = 'composer' | 'gate' | 'user';

export type Verdict = 'allow' | 'approval' | 'deny';

export interface PresenceInput {
  /** The latest turn of the conversation (if any). */
  turn?: Turn;
  /** The composer has text and focus. */
  typing?: boolean;
  /** Admin test session ("test as"): Steward sees through someone else's eyes. */
  testAs?: boolean;
  kill?: KillMode;
  /** A flash detected by `detectFlash` that has not expired yet. */
  flash?: Flash | null;
  /** No input for a while: Steward dozes off (wakes on any input). */
  dozing?: boolean;
  /** Idle micro-life: a short glance at the composer. */
  glance?: boolean;
}

/** What Steward says right now, in first person (an i18n key plus its values). */
export interface Line {
  key: MessageKey;
  vars?: Record<string, string | number>;
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
  /** Where he looks (the component turns it into a head pose for its layout). */
  look: Look | null;
  gesture: 'shake' | 'hop' | 'nod' | null;
  glasses: boolean;
  dimmed: boolean;
  /** Freeze the body (kill switch). */
  frozen: boolean;
  /** Sub-agent budded off by an A2A handoff in the running turn. */
  companion: Companion | null;
  label: MessageKey;
  say: Line;
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

/** A one-off reaction between two snapshots of the latest turn (sent > denied > approved > done). */
export function detectFlash(prev: Turn | undefined, next: Turn | undefined): Flash | null {
  if (!next) return null;
  if (prev?.id !== next.id) return next.status === 'streaming' && !next.restored ? 'sent' : null;
  const before = prev;
  if (decisions(next, 'deny') > decisions(before, 'deny')) return 'denied';
  if (approvedCount(next) > approvedCount(before)) return 'approved';
  if (before?.status === 'streaming' && next.status === 'done') return 'done';
  return null;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Ticket t-2051", "Deal d-1007" from well-known argument names, else the tool name. */
export function thingOf(tool: string, args: unknown): string {
  if (args && typeof args === 'object') {
    const a = args as Record<string, unknown>;
    const pick = (k: string) => (typeof a[k] === 'string' || typeof a[k] === 'number' ? String(a[k]) : null);
    const ticket = pick('ticket_id');
    if (ticket) return `Ticket ${ticket}`;
    const deal = pick('deal_id');
    if (deal) return `Deal ${deal}`;
    const issue = pick('issue_id');
    if (issue) return issue;
  }
  return tool;
}

const READISH = /^(get|list|search|query|read|find|fetch|lookup)/;

/** The tool call Steward is busy with (no result yet, not denied). */
function inFlight(turn: Turn): ToolItem | undefined {
  return [...turn.items].reverse().find((x): x is ToolItem => x.kind === 'tool' && !x.result && x.decision?.effect !== 'deny');
}

function sayFor(state: PresenceState, turn: Turn | undefined, input: PresenceInput, companion: Companion | null): Line {
  switch (state) {
    case 'denied':
      return { key: 'presence.say.denied' };
    case 'approved': {
      const ap = turn ? [...turn.items].reverse().find((x) => x.kind === 'approval' && x.status === 'approved') : undefined;
      const voter = ap?.kind === 'approval' ? (ap.votes.find((v) => v.approve)?.user ?? ap.approvers[0]) : undefined;
      return { key: 'presence.say.approved', vars: { who: cap(voter ?? 'Warden') } };
    }
    case 'awaiting_approval': {
      const ap = turn?.items.find((x) => x.kind === 'approval' && x.status === 'pending');
      // The user's own turn: the gate asks them to run or cancel.
      if (ap?.kind === 'approval' && ap.awaiting === 'requester') return { key: 'presence.say.confirm' };
      const who = ap?.kind === 'approval' && ap.approvers.length ? ap.approvers.map(cap).join(' / ') : '?';
      return { key: 'presence.say.awaiting', vars: { who } };
    }
    case 'calling_tools': {
      const call = turn ? inFlight(turn) : undefined;
      if (!call) return { key: 'presence.say.thinking' };
      const thing = thingOf(call.tool, call.args);
      if (!call.decision) return { key: 'presence.say.asking', vars: { thing } };
      const verb = READISH.test(call.tool.split('.').pop() ?? '') ? 'presence.say.reading' : 'presence.say.calling';
      return { key: verb, vars: { thing } };
    }
    case 'thinking':
      if (companion) return { key: `presence.say.handoff.${companion.role}` as MessageKey };
      return { key: 'presence.say.thinking' };
    case 'composing':
      return { key: 'presence.say.composing' };
    case 'done':
      return { key: 'presence.say.done' };
    case 'paused':
      return { key: input.kill === 'all' ? 'presence.say.pausedAll' : 'presence.say.pausedWrites' };
    case 'typing':
      return { key: 'presence.say.typing' };
    case 'error':
      return { key: turn?.items.some((x) => x.kind === 'budget') ? 'presence.say.budget' : 'presence.say.error' };
    case 'dozing':
      return { key: 'presence.say.dozing' };
    default:
      return { key: input.testAs ? 'presence.say.testAs' : 'presence.say.idle' };
  }
}

/** The presence for one snapshot. Priority: flash › running › done › kill › typing › error › dozing › idle. */
export function derivePresence(input: PresenceInput): Presence {
  const p = derive(input);
  // A nod when a message is sent, on top of whatever he is doing.
  return input.flash === 'sent' && !p.gesture ? { ...p, gesture: 'nod', look: p.look ?? 'user' } : p;
}

function derive(input: PresenceInput): Presence {
  const { turn, typing = false, testAs = false, kill = 'off', flash = null, dozing = false, glance = false } = input;
  const companion = companionOf(turn);
  const base: Presence = {
    state: 'idle',
    avatar: 'default',
    orb: null,
    rim: null,
    gesture: null,
    look: null,
    glasses: testAs,
    dimmed: kill !== 'off',
    frozen: false,
    companion,
    label: 'presence.idle',
    say: { key: 'presence.say.idle' },
  };
  const is = (state: PresenceState, extra: Partial<Presence>): Presence => ({
    ...base,
    state,
    label: `presence.${state}` as MessageKey,
    say: sayFor(state, turn, input, companion),
    ...extra,
  });

  if (flash === 'denied') return is('denied', { rim: 'deny', gesture: 'shake' });
  if (flash === 'approved') return is('approved', { rim: 'allow', gesture: 'hop' });
  if (turn && running(turn)) {
    if (pendingApproval(turn)) return is('awaiting_approval', { orb: 'breathing', rim: 'approval', look: 'gate' });
    if (toolInFlight(turn)) return is('calling_tools', { avatar: 'working', orb: 'searching' });
    if (turn.answer) return is('composing', { avatar: 'working', orb: 'composing', look: 'user' });
    return is('thinking', { avatar: 'working', orb: 'solving' });
  }
  if (flash === 'done') return is('done', { gesture: 'nod' });
  if (kill !== 'off') return is('paused', { avatar: 'sleeping', frozen: true });
  if (typing) return is('typing', { look: 'composer' });
  if (turn && failed(turn)) return is('error', { avatar: 'sleeping' });
  if (dozing) return is('dozing', { avatar: 'sleeping' });
  return is('idle', glance ? { look: 'composer' } : {});
}
