// Thin client for the Steward BFF. The session is an HttpOnly cookie; every state-changing
// request carries `X-Steward: 1` (CSRF: a cross-site form cannot set custom headers).

import { readSse, toChatEvent } from './sse';
import type {
  AdminUsers,
  Approval,
  Approvals,
  Audit,
  ChatEvent,
  Connector,
  Costs,
  Effective,
  Info,
  KillMode,
  Me,
  MemoryList,
  PolicyInfo,
  Principal,
  WhatIfResult,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function errorFrom(r: Response): Promise<ApiError> {
  let msg = `HTTP ${r.status}`;
  try {
    const text = await r.text();
    try {
      const v = JSON.parse(text) as { error?: string };
      if (v && typeof v.error === 'string') msg = v.error;
    } catch {
      if (text) msg = text.slice(0, 300);
    }
  } catch {
    /* ignore */
  }
  return new ApiError(r.status, msg);
}

/** Called on every 401, so the app can show the login screen. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(f: (() => void) | null) {
  onUnauthorized = f;
}

export async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-Steward'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
  if (!r.ok) {
    if (r.status === 401 && path !== '/api/me') onUnauthorized?.();
    throw await errorFrom(r);
  }
  const type = r.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return (await r.json()) as T;
  return (await r.text()) as unknown as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
const del = <T>(path: string) => request<T>('DELETE', path);

export const api = {
  info: () => get<Info>('/api/info'),
  me: () => get<Me>('/api/me'),
  devLogin: (user: string) => post<{ ok: boolean; user: string }>('/api/dev-login', { user }),
  logout: () => post<{ ok: boolean }>('/api/logout'),

  history: () => get<{ messages: { role: 'user' | 'assistant'; text: string }[] }>('/api/chat/history'),
  clearHistory: () => del<{ ok: boolean }>('/api/chat/history'),

  approvals: () => get<Approvals>('/api/approvals'),
  decide: (id: string, decision: 'approve' | 'deny', reason?: string) =>
    post<{ approval: Approval }>(`/api/approvals/${encodeURIComponent(id)}`, { decision, reason: reason || undefined }),

  memory: () => get<MemoryList>('/api/memory'),
  forget: (id: number) => del<{ forgotten: number }>(`/api/memory/${id}`),
  forgetAll: () => del<{ forgotten: number }>('/api/memory'),

  costs: (days: number) => get<Costs>(`/api/costs?days=${days}`),

  adminUsers: () => get<AdminUsers>('/api/admin/users'),
  setRoles: (id: string, roles: string[]) =>
    post<{ ok: boolean; sessions_ended: number; logout_error: string | null; revoke_error: string | null }>(
      `/api/admin/users/${encodeURIComponent(id)}/roles`,
      { roles },
    ),
  effective: (id: string) => get<Effective>(`/api/admin/effective/${encodeURIComponent(id)}`),
  policy: () => get<PolicyInfo>('/api/admin/policy'),
  whatIf: (principal: Principal, action: { kind: string; name: string; args: unknown }) =>
    post<WhatIfResult>('/api/admin/what-if', { principal, action }),
  testAs: (user: string) => post<{ ok: boolean; user: string }>('/api/admin/test-as', { user }),
  endTestAs: () => post<{ ok: boolean }>('/api/admin/test-as/end'),
  audit: (n = 100) => get<Audit>(`/api/admin/audit?n=${n}`),
  kill: () => get<{ mode: KillMode }>('/api/admin/kill'),
  setKill: (mode: KillMode) => post<{ mode: KillMode }>('/api/admin/kill', { mode }),
  connectors: () => get<{ connectors: Connector[] }>('/api/admin/connectors'),

  pageImageUrl: (doc: string, page: number) => `/api/docs/pages/${encodeURIComponent(doc)}/${page}.png`,
};

/**
 * `POST /api/chat`: run one turn and stream its events. Resolves when the stream ends
 * (after `done`), rejects on HTTP errors (409 while another turn runs in this session).
 */
export async function streamChat(
  message: string,
  opts: { signal?: AbortSignal; onEvent: (e: ChatEvent) => void },
): Promise<void> {
  const r = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-Steward': '1' },
    body: JSON.stringify({ message }),
    signal: opts.signal,
  });
  if (!r.ok) {
    if (r.status === 401) onUnauthorized?.();
    throw await errorFrom(r);
  }
  if (!r.body) throw new ApiError(500, 'empty response');
  let done = false;
  await readSse(
    r.body,
    (m) => {
      const e = toChatEvent(m);
      if (!e) return;
      if (e.type === 'done') done = true;
      opts.onEvent(e);
    },
    opts.signal,
  );
  if (!done && !opts.signal?.aborted) {
    opts.onEvent({ type: 'error', message: 'stream ended early' });
    opts.onEvent({ type: 'done', answer: '', run_id: '', eur: 0 });
  }
}
