// Folds the chat events of one turn into what the UI shows: the answer text and an "activity"
// timeline (tool calls with Warden decisions, handoffs, approvals, citations, memory, costs).
// Pure and synchronous so it is easy to test.

import type { ApprovalStatus, ChatEvent, Effect, Vote } from './types';

export interface ToolItem {
  kind: 'tool';
  key: string;
  /** Call id from the model (absent while only the decision is known). */
  id?: string;
  tool: string;
  agent: string;
  args?: unknown;
  decision?: { effect: Effect | string; rule: string };
  result?: { ok: boolean; preview: string };
  approvalId?: string;
}

export interface HandoffItem {
  kind: 'handoff';
  key: string;
  from: string;
  to: string;
  skill: string;
  taskId: string | null;
  decision?: { effect: Effect | string; rule: string };
}

export interface ApprovalItem {
  kind: 'approval';
  key: string;
  approvalId: string;
  tool: string;
  rule: string;
  approvers: string[];
  args: unknown;
  status: ApprovalStatus;
  votes: Vote[];
}

export interface CitationItem {
  kind: 'citation';
  key: string;
  docId: string;
  title: string;
  page: number;
  quote: string;
  url: string;
}

export interface NoticeItem {
  kind: 'abstained' | 'budget' | 'error';
  key: string;
  text: string;
}

export interface MemoryItem {
  kind: 'memory';
  key: string;
  variant: 'used' | 'stored' | 'refused';
  count?: number;
  text?: string;
}

export type ActivityItem = ToolItem | HandoffItem | ApprovalItem | CitationItem | NoticeItem | MemoryItem;

export interface TurnCost {
  eur: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  models: string[];
}

export type TurnStatus = 'streaming' | 'done' | 'error';

export interface Turn {
  id: string;
  question: string;
  answer: string;
  status: TurnStatus;
  items: ActivityItem[];
  cost: TurnCost;
  runId?: string;
  /** Run total reported by `done` (the orchestrator's run). */
  runEur?: number;
  /** Turn restored from history (no activity known). */
  restored?: boolean;
  /** When the turn started (ms since epoch; absent for turns restored from history). */
  startedAt?: number;
}

export function newTurn(id: string, question: string, startedAt: number | undefined = Date.now()): Turn {
  return {
    id,
    question,
    answer: '',
    status: 'streaming',
    items: [],
    cost: { eur: 0, inputTokens: 0, outputTokens: 0, calls: 0, models: [] },
    startedAt,
  };
}

/** `tool:crm.update_deal` → `crm.update_deal`. */
export function bareTool(action: string): string {
  const i = action.indexOf(':');
  return i >= 0 ? action.slice(i + 1) : action;
}

function lastIndex<T>(xs: T[], pred: (x: T) => boolean): number {
  for (let i = xs.length - 1; i >= 0; i--) {
    const x = xs[i];
    if (x !== undefined && pred(x)) return i;
  }
  return -1;
}

function replaceAt<T>(xs: T[], i: number, x: T): T[] {
  const copy = xs.slice();
  copy[i] = x;
  return copy;
}

function decidedStatus(e: Extract<ChatEvent, { type: 'approval_decided' }>): ApprovalStatus {
  if (e.status) return e.status;
  switch (e.decision) {
    case 'approve':
    case 'approved':
      return 'approved';
    case 'deny':
    case 'denied':
      return 'denied';
    case 'expired':
    case 'timeout':
      return 'expired';
    default:
      return 'pending';
  }
}

/** Apply one event to a turn. Returns the same object when nothing changed. */
export function applyEvent(turn: Turn, e: ChatEvent): Turn {
  const n = turn.items.length;
  const key = `${turn.id}:${n}`;
  switch (e.type) {
    case 'token':
      return { ...turn, answer: turn.answer + e.text };

    case 'tool_call': {
      // The decision may arrive first (denied calls are decided before the call is reported).
      const i = lastIndex(turn.items, (x) => x.kind === 'tool' && x.tool === e.tool && x.id === undefined && x.agent === e.agent);
      if (i >= 0) {
        const item = turn.items[i] as ToolItem;
        return { ...turn, items: replaceAt(turn.items, i, { ...item, id: e.id, args: e.args }) };
      }
      const item: ToolItem = { kind: 'tool', key, id: e.id, tool: e.tool, agent: e.agent, args: e.args };
      return { ...turn, items: [...turn.items, item] };
    }

    case 'decision': {
      const decision = { effect: e.effect, rule: e.rule };
      // A2A skills: the decision belongs to the handoff.
      const h = lastIndex(turn.items, (x) => x.kind === 'handoff' && x.skill === e.tool && !x.decision);
      if (h >= 0) {
        const item = turn.items[h] as HandoffItem;
        return { ...turn, items: replaceAt(turn.items, h, { ...item, decision }) };
      }
      const i = lastIndex(turn.items, (x) => x.kind === 'tool' && x.tool === e.tool && !x.decision && !x.result && x.agent === e.agent);
      if (i >= 0) {
        const item = turn.items[i] as ToolItem;
        return { ...turn, items: replaceAt(turn.items, i, { ...item, decision }) };
      }
      const item: ToolItem = { kind: 'tool', key, tool: e.tool, agent: e.agent, decision };
      return { ...turn, items: [...turn.items, item] };
    }

    case 'tool_result': {
      let i = lastIndex(turn.items, (x) => x.kind === 'tool' && x.id === e.id && x.tool === e.tool && !x.result);
      if (i < 0) i = lastIndex(turn.items, (x) => x.kind === 'tool' && x.tool === e.tool && !x.result);
      const result = { ok: e.ok, preview: e.preview };
      if (i >= 0) {
        const item = turn.items[i] as ToolItem;
        return { ...turn, items: replaceAt(turn.items, i, { ...item, result }) };
      }
      const item: ToolItem = { kind: 'tool', key, id: e.id, tool: e.tool, agent: '', result };
      return { ...turn, items: [...turn.items, item] };
    }

    case 'approval_pending': {
      if (turn.items.some((x) => x.kind === 'approval' && x.approvalId === e.approval_id)) return turn;
      const tool = bareTool(e.tool);
      const approval: ApprovalItem = {
        kind: 'approval',
        key,
        approvalId: e.approval_id,
        tool,
        rule: e.rule,
        approvers: e.approvers ?? [],
        args: e.args,
        status: 'pending',
        votes: [],
      };
      let items = [...turn.items, approval];
      const t = lastIndex(items, (x) => x.kind === 'tool' && x.tool === tool && !x.result && !x.approvalId);
      if (t >= 0) items = replaceAt(items, t, { ...(items[t] as ToolItem), approvalId: e.approval_id });
      return { ...turn, items };
    }

    case 'approval_decided': {
      const i = turn.items.findIndex((x) => x.kind === 'approval' && x.approvalId === e.approval_id);
      if (i < 0) return turn;
      const item = turn.items[i] as ApprovalItem;
      const votes = e.votes ?? (e.approver ? e.approver.split('+').map((user) => ({ user, approve: decidedStatus(e) === 'approved', reason: null })) : item.votes);
      return { ...turn, items: replaceAt(turn.items, i, { ...item, status: decidedStatus(e), votes }) };
    }

    case 'citation': {
      if (turn.items.some((x) => x.kind === 'citation' && x.docId === e.doc_id && x.page === e.page && x.quote === e.quote)) return turn;
      const item: CitationItem = { kind: 'citation', key, docId: e.doc_id, title: e.title, page: e.page, quote: e.quote, url: e.url };
      return { ...turn, items: [...turn.items, item] };
    }

    case 'abstained':
      return { ...turn, items: [...turn.items, { kind: 'abstained', key, text: e.tool }] };

    case 'agent_handoff': {
      const item: HandoffItem = { kind: 'handoff', key, from: e.from, to: e.to, skill: e.skill, taskId: e.task_id ?? null };
      return { ...turn, items: [...turn.items, item] };
    }

    case 'memory_used': {
      if (turn.items.some((x) => x.kind === 'memory' && x.variant === 'used')) return turn;
      return { ...turn, items: [...turn.items, { kind: 'memory', key, variant: 'used', count: e.count }] };
    }
    case 'memory_stored':
      return { ...turn, items: [...turn.items, { kind: 'memory', key, variant: 'stored', text: e.fact }] };
    case 'memory_refused':
      return { ...turn, items: [...turn.items, { kind: 'memory', key, variant: 'refused', text: e.reason }] };

    case 'cost': {
      const c = turn.cost;
      return {
        ...turn,
        cost: {
          eur: c.eur + (e.eur || 0),
          inputTokens: c.inputTokens + (e.input_tokens || 0),
          outputTokens: c.outputTokens + (e.output_tokens || 0),
          calls: c.calls + 1,
          models: c.models.includes(e.model) ? c.models : [...c.models, e.model],
        },
      };
    }

    case 'budget_exceeded':
      return { ...turn, items: [...turn.items, { kind: 'budget', key, text: e.reason }] };

    case 'error':
      return { ...turn, items: [...turn.items, { kind: 'error', key, text: e.message }] };

    case 'done': {
      const hasError = turn.items.some((x) => x.kind === 'error');
      return {
        ...turn,
        answer: e.answer && e.answer.length >= turn.answer.length ? e.answer : turn.answer,
        status: hasError && !e.answer ? 'error' : 'done',
        runId: e.run_id || undefined,
        runEur: e.eur,
      };
    }

    default:
      return turn;
  }
}

export function applyEvents(turn: Turn, events: ChatEvent[]): Turn {
  return events.reduce(applyEvent, turn);
}

/** The approval items still waiting for a decision. */
export function pendingApprovals(turn: Turn): ApprovalItem[] {
  return turn.items.filter((x): x is ApprovalItem => x.kind === 'approval' && x.status === 'pending');
}

/** Short German/English-agnostic label for an agent client id (`acme-research` → `research`). */
export function agentRole(agent: string, agents?: Record<string, string>): string {
  if (agents) {
    for (const [role, id] of Object.entries(agents)) if (id === agent) return role;
  }
  const m = /-(research|action)$/.exec(agent);
  if (m?.[1]) return m[1];
  return 'orchestrator';
}
