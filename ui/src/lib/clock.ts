import { useEffect, useRef, useState } from 'react';

/** m:ss (or h:mm:ss) for gate timers. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Live elapsed time since `start` (ms) while `running`; frozen once it stops. */
export function useElapsed(start: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const stopped = useRef<number | null>(null);
  useEffect(() => {
    if (!running) {
      stopped.current ??= Date.now();
      return;
    }
    stopped.current = null;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return (stopped.current ?? now) - start;
}
