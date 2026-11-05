// Live updates for the signed-in user over `GET /api/events` (SSE): approval requests to decide
// and decisions on the user's own requests. Drives the inbox badge and toasts.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useI18n } from '@/context/i18n';
import { useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import { api } from '@/lib/api';
import { bareTool } from '@/lib/timeline';
import type { Approvals, LiveEvent } from '@/lib/types';

type Listener = (e: LiveEvent) => void;

interface Live {
  approvals: Approvals | null;
  toDecide: number;
  reload: () => Promise<void>;
  subscribe: (f: Listener) => () => void;
  connected: boolean;
}

const Ctx = createContext<Live>({ approvals: null, toDecide: 0, reload: async () => {}, subscribe: () => () => {}, connected: false });

const TYPES: LiveEvent['type'][] = ['approval_requested', 'approval_pending', 'approval_decided'];

export function LiveProvider({ children }: { children: ReactNode }) {
  const { status, me } = useSession();
  const { t } = useI18n();
  const { toast } = useToast();
  const [approvals, setApprovals] = useState<Approvals | null>(null);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<Listener>());
  const approvalsRef = useRef<Approvals | null>(null);
  approvalsRef.current = approvals;

  const reload = useCallback(async () => {
    try {
      setApprovals(await api.approvals());
    } catch {
      /* the badge is best effort */
    }
  }, []);

  const subscribe = useCallback((f: Listener) => {
    listeners.current.add(f);
    return () => {
      listeners.current.delete(f);
    };
  }, []);

  const user = me?.user;
  useEffect(() => {
    if (status !== 'authenticated' || !user) {
      setApprovals(null);
      return;
    }
    void reload();
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events', { withCredentials: true });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const handle = (raw: MessageEvent<string>) => {
      let e: LiveEvent;
      try {
        e = JSON.parse(raw.data) as LiveEvent;
      } catch {
        return;
      }
      if (e.type === 'approval_requested') {
        toast(t('approvals.toastNew', { user: e.approval.requester, tool: bareTool(e.approval.action) }), {
          link: { to: '/approvals', label: t('approval.open') },
        });
      } else if (e.type === 'approval_decided') {
        const mine = approvalsRef.current?.mine.find((a) => a.id === e.approval_id);
        if (mine && mine.requester === user) {
          const status = t(`approval.${e.status}` as const);
          toast(t('approvals.toastDecided', { status, tool: bareTool(mine.action) }), {
            variant: e.status === 'approved' ? 'success' : e.status === 'denied' ? 'error' : 'info',
          });
        }
      }
      void reload();
      listeners.current.forEach((f) => f(e));
    };
    for (const type of TYPES) es.addEventListener(type, handle as EventListener);
    return () => {
      for (const type of TYPES) es.removeEventListener(type, handle as EventListener);
      es.close();
      setConnected(false);
    };
  }, [status, user, reload, toast, t]);

  const value = useMemo(
    () => ({ approvals, toDecide: approvals?.to_decide.length ?? 0, reload, subscribe, connected }),
    [approvals, reload, subscribe, connected],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive(): Live {
  return useContext(Ctx);
}
