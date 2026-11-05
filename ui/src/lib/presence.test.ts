import { describe, expect, it } from 'vitest';

import { companionOf, derivePresence, detectFlash } from './presence';
import { applyEvents, newTurn, type Turn } from './timeline';
import type { ChatEvent } from './types';

const run = (events: ChatEvent[]): Turn => applyEvents(newTurn('t1', 'question'), events);

const dealCall: ChatEvent[] = [
  { type: 'tool_call', id: 'c', tool: 'crm.update_deal', args: { deal_id: 'd-1007', amount: 80000 }, agent: 'acme-bot' },
  { type: 'decision', tool: 'crm.update_deal', effect: 'require_approval', rule: 'big-deals-need-approval', agent: 'acme-bot' },
];
const held: ChatEvent[] = [
  ...dealCall,
  { type: 'approval_pending', approval_id: 'ap1', tool: 'tool:crm.update_deal', rule: 'big-deals-need-approval', approvers: ['sara'], args: {} },
];

describe('presence state machine', () => {
  it('is idle with no conversation, and turns to the composer while typing', () => {
    expect(derivePresence({}).state).toBe('idle');
    const p = derivePresence({ typing: true });
    expect(p.state).toBe('typing');
    expect(p.pose?.pitch).toBeLessThan(0);
    expect(p.rim).toBeNull();
  });

  it('thinks, calls tools and composes while the turn runs', () => {
    expect(derivePresence({ turn: run([]) })).toMatchObject({ state: 'thinking', avatar: 'working', orb: 'solving' });
    const calling = run([{ type: 'tool_call', id: 'a', tool: 'docs.search', args: {}, agent: 'acme-bot' }]);
    expect(derivePresence({ turn: calling })).toMatchObject({ state: 'calling_tools', avatar: 'working', orb: 'searching' });
    const writing = run([
      { type: 'tool_call', id: 'a', tool: 'docs.search', args: {}, agent: 'acme-bot' },
      { type: 'decision', tool: 'docs.search', effect: 'allow', rule: 'r', agent: 'acme-bot' },
      { type: 'tool_result', id: 'a', tool: 'docs.search', ok: true, preview: '' },
      { type: 'token', text: 'Laut Handbuch …' },
    ]);
    expect(derivePresence({ turn: writing })).toMatchObject({ state: 'composing', orb: 'composing' });
  });

  it('awaits an approval with an ember rim and looks toward the card', () => {
    const p = derivePresence({ turn: run(held), typing: true });
    expect(p).toMatchObject({ state: 'awaiting_approval', orb: 'breathing', rim: 'approval' });
    expect(p.pose?.pitch).toBeGreaterThan(0);
  });

  it('flashes red and shakes its head on a Warden deny', () => {
    const before = run([{ type: 'tool_call', id: 'a', tool: 'hr.get_salary', args: {}, agent: 'acme-bot' }]);
    const after = applyEvents(before, [{ type: 'decision', tool: 'hr.get_salary', effect: 'deny', rule: 'scope.missing', agent: 'acme-bot' }]);
    const flash = detectFlash(before, after);
    expect(flash).toBe('denied');
    expect(derivePresence({ turn: after, flash })).toMatchObject({ state: 'denied', rim: 'deny', gesture: 'shake' });
    // After the flash the turn continues normally.
    expect(derivePresence({ turn: after }).state).toBe('thinking');
  });

  it('hops with a teal rim when the approval is given, nods when done', () => {
    const before = run(held);
    const after = applyEvents(before, [{ type: 'approval_decided', approval_id: 'ap1', status: 'approved', votes: [{ user: 'sara', approve: true, reason: null }] }]);
    expect(detectFlash(before, after)).toBe('approved');
    expect(derivePresence({ turn: after, flash: 'approved' })).toMatchObject({ state: 'approved', rim: 'allow', gesture: 'hop' });

    const done = applyEvents(after, [{ type: 'done', answer: 'Erledigt.', run_id: 'r', eur: 0 }]);
    expect(detectFlash(after, done)).toBe('done');
    const p = derivePresence({ turn: done, flash: 'done' });
    expect(p).toMatchObject({ state: 'done', gesture: 'nod' });
    // Finishing is not a verdict: no color.
    expect(p.rim).toBeNull();
    expect(derivePresence({ turn: done }).state).toBe('idle');
  });

  it('does not flash for a new turn or an unchanged one', () => {
    const a = run(held);
    expect(detectFlash(a, a)).toBeNull();
    expect(detectFlash(undefined, undefined)).toBeNull();
    const other = { ...run([]), id: 't2' };
    expect(detectFlash(a, other)).toBeNull();
  });

  it('sleeps after an error or a budget stop, and typing wakes it', () => {
    const budget = applyEvents(run([{ type: 'budget_exceeded', reason: 'Tagesbudget' }]), [{ type: 'done', answer: '', run_id: '', eur: 0 }]);
    expect(derivePresence({ turn: budget })).toMatchObject({ state: 'error', avatar: 'sleeping' });
    expect(derivePresence({ turn: budget, typing: true }).state).toBe('typing');
  });

  it('listens with headphones and a listening halo', () => {
    expect(derivePresence({ listening: true })).toMatchObject({ state: 'listening', headphones: true, orb: 'listening' });
  });

  it('wears glasses in a test session and is dimmed and paused by the kill switch', () => {
    expect(derivePresence({ testAs: true })).toMatchObject({ state: 'idle', glasses: true });
    expect(derivePresence({ kill: 'all' })).toMatchObject({ state: 'paused', dimmed: true, frozen: true, avatar: 'sleeping' });
    // A running turn still shows its activity, dimmed.
    expect(derivePresence({ kill: 'writes', turn: run([]) })).toMatchObject({ state: 'thinking', dimmed: true });
  });

  it('buds off a sub-agent on a handoff and merges it back when Steward acts again', () => {
    const handoff = run([{ type: 'agent_handoff', from: 'acme-bot', to: 'acme-bot-research', skill: 'research', task_id: 't' }]);
    expect(companionOf(handoff)).toMatchObject({ role: 'research', working: true });
    const sub = applyEvents(handoff, [{ type: 'tool_call', id: 'r', tool: 'docs.search', args: {}, agent: 'acme-bot-research' }]);
    expect(companionOf(sub)?.role).toBe('research');
    const back = applyEvents(sub, [{ type: 'tool_call', id: 'o', tool: 'crm.get_deal', args: {}, agent: 'acme-bot' }]);
    expect(companionOf(back)).toBeNull();
    const done = applyEvents(sub, [{ type: 'done', answer: 'x', run_id: '', eur: 0 }]);
    expect(companionOf(done)).toBeNull();
  });
});
