import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, setUnauthorizedHandler } from '@/lib/api';
import type { Info, Me } from '@/lib/types';

type Status = 'loading' | 'anonymous' | 'authenticated' | 'offline';

interface Session {
  status: Status;
  info: Info | null;
  me: Me | null;
  error: string | null;
  /** Reload `/api/me` (after login, test-as, role changes). */
  refresh: () => Promise<Me | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [info, setInfo] = useState<Info | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      setStatus('authenticated');
      return m;
    } catch (e) {
      setMe(null);
      if (e instanceof ApiError && e.status === 401) {
        setStatus('anonymous');
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('offline');
      }
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const i = await api.info();
        if (cancelled) return;
        setInfo(i);
        document.documentElement.lang = i.locale.slice(0, 2) || 'en';
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('offline');
        return;
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setMe(null);
      setStatus('anonymous');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setMe(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(() => ({ status, info, me, error, refresh, logout }), [status, info, me, error, refresh, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** For pages behind the login: `me` is always set there. */
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error('useMe without a session');
  return me;
}
