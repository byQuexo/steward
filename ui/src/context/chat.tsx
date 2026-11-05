// Chat state lives above the routes, so a running turn keeps streaming while the user looks at
// the inbox or the console.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useI18n } from '@/context/i18n';
import { useLive } from '@/context/live';
import { useSession } from '@/context/session';
import { api, ApiError, streamChat } from '@/lib/api';
import { applyEvent, newTurn, type Turn } from '@/lib/timeline';
import type { ChatEvent } from '@/lib/types';
import { errorMessage } from '@/lib/utils';

interface Chat {
  turns: Turn[];
  busy: boolean;
  send: (message: string) => Promise<Turn | null>;
  cancel: () => void;
  clear: () => Promise<void>;
}

const Ctx = createContext<Chat | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { me, status } = useSession();
  const { subscribe } = useLive();
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const user = me?.user;
  const sessionKey = `${user ?? ''}|${me?.impersonated_by ?? ''}`;

  // New user (login, test-as): start from the server's history for this session.
  useEffect(() => {
    abort.current?.abort();
    setTurns([]);
    setBusy(false);
    if (status !== 'authenticated') return;
    let cancelled = false;
    api
      .history()
      .then(({ messages }) => {
        if (cancelled) return;
        const restored: Turn[] = [];
        for (const m of messages) {
          if (m.role === 'user') {
            restored.push({ ...newTurn(`h${counter.current++}`, m.text), status: 'done', restored: true, startedAt: undefined });
          } else {
            const last = restored[restored.length - 1];
            if (last && !last.answer) last.answer = m.text;
          }
        }
        setTurns((cur) => (cur.length === 0 ? restored : cur));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionKey, status]);

  // Approval decisions may also arrive on the live stream; keep the cards in sync.
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type !== 'approval_decided') return;
        setTurns((ts) => ts.map((turn) => applyEvent(turn, e as ChatEvent)));
      }),
    [subscribe],
  );

  const update = useCallback((id: string, f: (t: Turn) => Turn) => {
    setTurns((ts) => ts.map((x) => (x.id === id ? f(x) : x)));
  }, []);

  const send = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || busy) return null;
      const id = `t${Date.now()}-${counter.current++}`;
      let turn = newTurn(id, text);
      setTurns((ts) => [...ts, turn]);
      setBusy(true);
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        await streamChat(text, {
          signal: ctrl.signal,
          onEvent: (e) => {
            turn = applyEvent(turn, e);
            const snapshot = turn;
            update(id, () => snapshot);
          },
        });
        if (turn.status === 'streaming') {
          turn = { ...turn, status: 'done' };
          const snapshot = turn;
          update(id, () => snapshot);
        }
      } catch (e) {
        if (ctrl.signal.aborted) {
          turn = { ...turn, status: 'done' };
        } else {
          const msg = e instanceof ApiError && e.status === 409 ? t('chat.busy') : t('chat.failed', { error: errorMessage(e) });
          turn = applyEvent({ ...applyEvent(turn, { type: 'error', message: msg }) }, { type: 'done', answer: '', run_id: '', eur: 0 });
          turn = { ...turn, status: 'error' };
        }
        const snapshot = turn;
        update(id, () => snapshot);
      } finally {
        if (abort.current === ctrl) abort.current = null;
        setBusy(false);
      }
      return turn;
    },
    [busy, t, update],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);

  const clear = useCallback(async () => {
    abort.current?.abort();
    try {
      await api.clearHistory();
    } finally {
      setTurns([]);
    }
  }, []);

  const value = useMemo(() => ({ turns, busy, send, cancel, clear }), [turns, busy, send, cancel, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat(): Chat {
  const c = useContext(Ctx);
  if (!c) throw new Error('useChat outside ChatProvider');
  return c;
}
