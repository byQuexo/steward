// Shapes of the Steward BFF API (crates/steward/src/{app,chat,admin,pages,inbox}.rs and
// crates/steward-agents/src/events.rs). Keep in sync with the backend.

export type Effect = 'allow' | 'deny' | 'require_approval';
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type KillMode = 'off' | 'writes' | 'all';

export interface DevUser {
  id: string;
  name: string;
  roles: string[];
  title: string | null;
}

export interface Info {
  profile: string;
  company: string;
  assistant: string;
  locale: string;
  login: 'dev' | 'oidc';
  dev_users: DevUser[];
}

export interface Me {
  user: string;
  name: string;
  roles: string[];
  attrs: Record<string, unknown>;
  agent: string;
  impersonated_by: string | null;
  admin: boolean;
  costs: boolean;
  assistant: string;
  company: string;
  greeting: string;
  suggestions: string[];
  tools: string[];
  voice: { mode: 'browser' | 'server' | string; language: string };
  kill_switch: KillMode;
}

// --- Chat events (ChatEvent, serde tag "type", snake_case) -----------------------------------

export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; id: string; tool: string; args: unknown; agent: string }
  | { type: 'decision'; tool: string; effect: Effect | string; rule: string; agent: string }
  | { type: 'tool_result'; id: string; tool: string; ok: boolean; preview: string }
  | { type: 'approval_pending'; approval_id: string; tool: string; rule: string; approvers: string[]; args: unknown }
  | {
      type: 'approval_decided';
      approval_id: string;
      // From the inbox bus:
      status?: ApprovalStatus;
      votes?: Vote[];
      // From ChatEvent::ApprovalDecided:
      decision?: string;
      approver?: string;
    }
  | { type: 'citation'; doc_id: string; title: string; page: number; quote: string; url: string }
  | { type: 'abstained'; tool: string }
  | { type: 'agent_handoff'; from: string; to: string; skill: string; task_id: string | null }
  | { type: 'memory_used'; count: number }
  | { type: 'memory_stored'; fact: string }
  | { type: 'memory_refused'; reason: string }
  | { type: 'cost'; eur: number; input_tokens: number; output_tokens: number; model: string; agent: string }
  | { type: 'budget_exceeded'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'done'; answer: string; run_id: string; eur: number };

export type ChatEventType = ChatEvent['type'];

// --- Approvals ---------------------------------------------------------------------------------

export interface Vote {
  user: string;
  approve: boolean;
  reason: string | null;
}

export interface Approval {
  id: string;
  requester: string;
  agent: string;
  act: string[];
  action: string;
  args: unknown;
  rule: string;
  reason: string;
  approvers: string[];
  four_eyes: boolean;
  votes: Vote[];
  status: ApprovalStatus;
  created: number;
}

export interface Approvals {
  to_decide: Approval[];
  mine: Approval[];
}

/** Events on `GET /api/events`. */
export type LiveEvent =
  | { type: 'approval_requested'; approval: Approval }
  | { type: 'approval_pending'; approval_id: string; tool: string; rule: string; approvers: string[]; args: unknown }
  | { type: 'approval_decided'; approval_id: string; status: ApprovalStatus; votes: Vote[] };

// --- Memory, costs -----------------------------------------------------------------------------

export interface Fact {
  id: number;
  owner: string;
  team: string | null;
  text: string;
  created_at: number;
}

export interface MemoryList {
  facts: Fact[];
  retention_days: number;
}

export interface Totals {
  key: string;
  eur: number;
  input_tokens: number;
  output_tokens: number;
  calls: number;
}

export interface CostEntry {
  run_id: string;
  user: string;
  team: string | null;
  agent: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  eur: number;
  ts: number;
}

export interface Budgets {
  per_run?: number | null;
  per_user_daily?: number | null;
  team_monthly?: Record<string, number>;
}

export type Costs =
  | { scope: 'me'; today_eur: number; budget_daily_eur: number | null }
  | {
      scope: 'all';
      currency: string;
      total_eur: number;
      by_user: Totals[];
      by_team: Totals[];
      by_agent: Totals[];
      by_model: Totals[];
      by_day: Totals[];
      recent: CostEntry[];
      budgets: Budgets;
      prices: Record<string, { input_per_mtok: number; output_per_mtok: number; cached_input_per_mtok?: number | null }>;
    };

// --- Admin -------------------------------------------------------------------------------------

export interface DirUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  attrs: Record<string, unknown>;
  enabled: boolean;
}

export interface AdminUsers {
  users: { user: DirUser; effective_scopes: string[]; title: string | null }[];
  roles: string[];
}

export interface Principal {
  subject: { id: string; kind?: string; roles: string[]; attrs: Record<string, unknown> };
  agent: string;
  act: string[];
  impersonated_by?: string | null;
  [k: string]: unknown;
}

export interface Effective {
  user: DirUser;
  principal: Principal;
  effective_scopes: string[];
  tools: string[];
  policy_version: string;
}

export interface PolicyInfo {
  catalog: string;
  policy: string;
  version: string;
  agents: Record<string, string>;
}

export interface TraceStep {
  step: string;
  outcome: string;
  detail?: string;
}

export interface WhatIfResult {
  effect: Effect;
  rule: string;
  reason: string;
  model_message: string;
  trace: TraceStep[];
  policy_version?: string;
}

export interface AuditEvent {
  event?: string;
  subject?: string;
  agent?: string;
  act?: string[];
  action?: { kind?: string; name?: string; args_hmac?: string };
  effect?: string;
  rule?: string;
  reason?: string;
  approval_id?: string;
  policy_version?: string;
  ts?: number | string;
  time?: string;
  [k: string]: unknown;
}

export interface Audit {
  events: AuditEvent[] | null;
  verify: { status: string; chains?: number; error?: string; [k: string]: unknown };
}

export interface ConnectorTool {
  name: string;
  scopes: string[];
  sensitivity: string;
  tags: string[];
}

export interface Connector {
  name: string;
  title: string;
  description: string;
  server: unknown;
  tools: ConnectorTool[];
  health: { state: string; consecutive_failures?: number; [k: string]: unknown };
}
