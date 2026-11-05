import { useCallback, useEffect, useRef, useState } from 'react';

import { useMe } from '@/context/session';

import type { Line } from './presence';

/**
 * Poking Steward: a short line about what he can do for this user (his tools, one of the user's
 * suggestions, or what Warden does). Shown for 4.5s; a change of `state` clears it.
 */
export function usePoke(state: string): { poked: Line | null; poke: () => void } {
  const me = useMe();
  const [poked, setPoked] = useState<{ line: Line; n: number } | null>(null);
  const last = useRef(-1);

  const poke = useCallback(() => {
    const lines: Line[] = [];
    if (me.tools.length) lines.push({ key: 'presence.click.tools', vars: { count: me.tools.length, tools: me.tools.slice(0, 3).join(', ') } });
    for (const s of me.suggestions.slice(0, 2)) lines.push({ key: 'presence.click.try', vars: { suggestion: s } });
    lines.push({ key: 'presence.click.warden' });
    let i = Math.floor(Math.random() * lines.length);
    if (lines.length > 1 && i === last.current) i = (i + 1) % lines.length;
    last.current = i;
    const line = lines[i];
    if (line) setPoked((x) => ({ line, n: (x?.n ?? 0) + 1 }));
  }, [me.tools, me.suggestions]);

  useEffect(() => {
    if (!poked) return;
    const id = window.setTimeout(() => setPoked(null), 4500);
    return () => window.clearTimeout(id);
  }, [poked]);

  useEffect(() => setPoked(null), [state]);

  return { poked: poked?.line ?? null, poke };
}
