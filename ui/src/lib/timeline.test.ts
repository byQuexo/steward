import { describe, expect, it } from 'vitest';

import { agentRole, applyEvents, bareTool, newTurn, pendingApprovals, type ApprovalItem, type ToolItem } from './timeline';
import type { ChatEvent } from './types';

const turn = () => newTurn('t1', 'question');

describe('timeline reducer', () => {
  it('concatenates tokens and takes the final answer from done', () => {
    const t = applyEvents(turn(), [
      { type: 'token', text: 'Hallo ' },
      { type: 'token', text: 'Welt' },
    ]);
    expect(t.answer).toBe('Hallo Welt');
    expect(t.status).toBe('streaming');
    const d = applyEvents(t, [{ type: 'done', answer: 'Hallo Welt!', run_id: 'r1', eur: 0.01 }]);
    expect(d.answer).toBe('Hallo Welt!');
    expect(d.status).toBe('done');
    expect(d.runId).toBe('r1');
  });

  it('merges tool_call, decision and tool_result into one item (allowed call)', () => {
    const t = applyEvents(turn(), [
      { type: 'tool_call', id: 'c0', tool: 'docs.search', args: { question: 'vpn' }, agent: 'acme-bot' },
      { type: 'decision', tool: 'docs.search', effect: 'allow', rule: 'scope.granted', agent: 'acme-bot' },
      { type: 'tool_result', id: 'c0', tool: 'docs.search', ok: true, preview: '{}' },
    ]);
    expect(t.items).toHaveLength(1);
    const item = t.items[0] as ToolItem;
    expect(item).toMatchObject({ kind: 'tool', id: 'c0', tool: 'docs.search', decision: { effect: 'allow', rule: 'scope.granted' }, result: { ok: true } });
  });

  it('handles a decision that arrives before the call (denied call)', () => {
    const t = applyEvents(turn(), [
      { type: 'decision', tool: 'hr.get_salary', effect: 'deny', rule: 'scope.missing', agent: 'acme-bot' },
      { type: 'tool_call', id: 'c1', tool: 'hr.get_salary', args: { unit: 'sales' }, agent: 'acme-bot' },
      { type: 'tool_result', id: 'c1', tool: 'hr.get_salary', ok: false, preview: 'Dafür habe ich keine Berechtigung.' },
    ]);
    expect(t.items).toHaveLength(1);
    expect(t.items[0]).toMatchObject({ id: 'c1', args: { unit: 'sales' }, decision: { effect: 'deny' }, result: { ok: false } });
  });

  it('keeps repeated calls of the same tool apart', () => {
    const t = applyEvents(turn(), [
      { type: 'tool_call', id: 'a', tool: 'hr.get_salary', args: { unit: 'hr' }, agent: 'acme-bot' },
      { type: 'decision', tool: 'hr.get_salary', effect: 'allow', rule: 'r', agent: 'acme-bot' },
      { type: 'tool_result', id: 'a', tool: 'hr.get_salary', ok: true, preview: '' },
      { type: 'decision', tool: 'hr.get_salary', effect: 'deny', rule: 'salary-only-own-unit', agent: 'acme-bot' },
      { type: 'tool_call', id: 'b', tool: 'hr.get_salary', args: { unit: 'sales' }, agent: 'acme-bot' },
    ]);
    expect(t.items).toHaveLength(2);
    expect(t.items[1]).toMatchObject({ id: 'b', decision: { effect: 'deny', rule: 'salary-only-own-unit' } });
  });

  it('links an approval to its tool call and updates it when decided (bus format)', () => {
    let t = applyEvents(turn(), [
      { type: 'tool_call', id: 'c', tool: 'crm.update_deal', args: { deal_id: 'd-1007', amount: 80000 }, agent: 'acme-bot' },
      { type: 'decision', tool: 'crm.update_deal', effect: 'require_approval', rule: 'big-deals-need-approval', agent: 'acme-bot' },
      {
        type: 'approval_pending',
        approval_id: 'ap1',
        tool: 'tool:crm.update_deal',
        rule: 'big-deals-need-approval',
        approvers: ['sara'],
        args: { deal_id: 'd-1007', amount: 80000 },
      },
    ]);
    expect(pendingApprovals(t)).toHaveLength(1);
    const tool = t.items[0] as ToolItem;
    expect(tool.approvalId).toBe('ap1');
    const ap = t.items[1] as ApprovalItem;
    expect(ap).toMatchObject({ kind: 'approval', tool: 'crm.update_deal', approvers: ['sara'], status: 'pending' });

    // A duplicate pending event (chat stream + live stream) does not add a second card.
    t = applyEvents(t, [{ type: 'approval_pending', approval_id: 'ap1', tool: 'tool:crm.update_deal', rule: 'x', approvers: [], args: {} }]);
    expect(t.items.filter((x) => x.kind === 'approval')).toHaveLength(1);

    t = applyEvents(t, [
      { type: 'approval_decided', approval_id: 'ap1', status: 'approved', votes: [{ user: 'sara', approve: true, reason: null }] },
      { type: 'tool_result', id: 'c', tool: 'crm.update_deal', ok: true, preview: '{"amount":80000}' },
    ]);
    expect(pendingApprovals(t)).toHaveLength(0);
    expect(t.items[1]).toMatchObject({ status: 'approved', votes: [{ user: 'sara', approve: true }] });
    expect(t.items[0]).toMatchObject({ result: { ok: true } });
  });

  it('understands the ChatEvent::ApprovalDecided format too', () => {
    const t = applyEvents(turn(), [
      { type: 'approval_pending', approval_id: 'x', tool: 'tool:ticket.close', rule: 'ticket-close-approval', approvers: ['ines'], args: {} },
      { type: 'approval_decided', approval_id: 'x', decision: 'deny', approver: 'ines' },
    ]);
    expect(t.items[0]).toMatchObject({ status: 'denied', votes: [{ user: 'ines', approve: false }] });
  });

  it('moves a held call from the confirmation by the user on to the approvers', () => {
    const held = { type: 'approval_pending', approval_id: 'b', tool: 'tool:crm.update_deal', rule: 'big-deals-need-approval', args: {} } as const;
    const t = applyEvents(turn(), [
      { ...held, approvers: ['sara'], awaiting: 'requester', confirmation: false },
      { ...held, approvers: ['sara'], awaiting: 'approvers', confirmation: false },
    ]);
    expect(t.items).toHaveLength(1);
    expect(t.items[0]).toMatchObject({ kind: 'approval', awaiting: 'approvers', status: 'pending', confirmation: false });
  });

  it('keeps a Warden confirmation as a decision of the user', () => {
    const t = applyEvents(turn(), [
      { type: 'approval_pending', approval_id: 'c', tool: 'tool:ticket.close', rule: 'confirm-writes', approvers: ['ivo'], args: {}, awaiting: 'requester', confirmation: true },
      { type: 'approval_decided', approval_id: 'c', status: 'denied', votes: [{ user: 'ivo', approve: false, reason: null }] },
    ]);
    expect(t.items[0]).toMatchObject({ awaiting: 'requester', confirmation: true, status: 'denied' });
  });

  it('ignores decisions for unknown approvals', () => {
    const t0 = turn();
    expect(applyEvents(t0, [{ type: 'approval_decided', approval_id: 'nope', status: 'approved', votes: [] }])).toBe(t0);
  });

  it('attaches the A2A skill decision to the handoff, and sub-agent calls stay separate', () => {
    const t = applyEvents(turn(), [
      { type: 'tool_call', id: 'd', tool: 'delegate_research', args: {}, agent: 'acme-bot' },
      { type: 'agent_handoff', from: 'acme-bot', to: 'acme-research', skill: 'research.deep_search', task_id: null },
      { type: 'decision', tool: 'research.deep_search', effect: 'allow', rule: 'a2a.skill', agent: 'acme-research' },
      { type: 'tool_call', id: 's', tool: 'crm.get_deal', args: { deal_id: 'd-1012' }, agent: 'acme-research' },
      { type: 'decision', tool: 'crm.get_deal', effect: 'allow', rule: 'scope.granted', agent: 'acme-research' },
    ]);
    expect(t.items.map((x) => x.kind)).toEqual(['tool', 'handoff', 'tool']);
    expect(t.items[1]).toMatchObject({ to: 'acme-research', decision: { effect: 'allow', rule: 'a2a.skill' } });
    expect(t.items[2]).toMatchObject({ agent: 'acme-research', decision: { effect: 'allow' } });
  });

  it('collects citations once, memory chips and notices', () => {
    const cite: ChatEvent = { type: 'citation', doc_id: 'it-vpn-setup', title: 'VPN', page: 2, quote: 'Zeit', url: '/api/docs/pages/it-vpn-setup/2.png' };
    const t = applyEvents(turn(), [
      cite,
      cite,
      { type: 'memory_used', count: 2 },
      { type: 'memory_used', count: 2 },
      { type: 'memory_stored', fact: 'Betreut Müller AG' },
      { type: 'memory_refused', reason: 'iban' },
      { type: 'abstained', tool: 'docs.search' },
      { type: 'budget_exceeded', reason: 'per_run' },
    ]);
    expect(t.items.map((x) => x.kind)).toEqual(['citation', 'memory', 'memory', 'memory', 'abstained', 'budget']);
    expect(t.items[0]).toMatchObject({ docId: 'it-vpn-setup', page: 2 });
  });

  it('sums costs per turn', () => {
    const t = applyEvents(turn(), [
      { type: 'cost', eur: 0.001, input_tokens: 1000, output_tokens: 40, model: 'scripted', agent: 'acme-bot' },
      { type: 'cost', eur: 0.002, input_tokens: 1500, output_tokens: 60, model: 'scripted', agent: 'acme-research' },
    ]);
    expect(t.cost.calls).toBe(2);
    expect(t.cost.eur).toBeCloseTo(0.003);
    expect(t.cost.inputTokens).toBe(2500);
    expect(t.cost.outputTokens).toBe(100);
    expect(t.cost.models).toEqual(['scripted']);
  });

  it('marks a turn with only an error as failed', () => {
    const t = applyEvents(turn(), [
      { type: 'error', message: 'boom' },
      { type: 'done', answer: '', run_id: '', eur: 0 },
    ]);
    expect(t.status).toBe('error');
    expect(t.items[0]).toMatchObject({ kind: 'error', text: 'boom' });
  });

  it('gives every item a stable unique key', () => {
    const t = applyEvents(turn(), [
      { type: 'memory_used', count: 1 },
      { type: 'abstained', tool: 'docs.search' },
      { type: 'error', message: 'x' },
    ]);
    expect(new Set(t.items.map((x) => x.key)).size).toBe(3);
  });
});

describe('helpers', () => {
  it('bareTool strips the action kind', () => {
    expect(bareTool('tool:crm.update_deal')).toBe('crm.update_deal');
    expect(bareTool('crm.update_deal')).toBe('crm.update_deal');
  });
  it('agentRole maps client ids to roles', () => {
    expect(agentRole('acme-research')).toBe('research');
    expect(agentRole('acme-action')).toBe('action');
    expect(agentRole('acme-bot')).toBe('orchestrator');
    expect(agentRole('x', { research: 'x' })).toBe('research');
  });
});
