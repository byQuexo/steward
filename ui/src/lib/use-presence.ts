import { useEffect, useRef, useState } from 'react';

import { derivePresence, detectFlash, FLASH_MS, type Flash, type Presence, type PresenceInput } from './presence';
import type { Turn } from './timeline';

/** Derive the presence and keep flash states (deny, approved, done) alive for their duration. */
export function usePresence(input: Omit<PresenceInput, 'flash'>): { presence: Presence; nonce: number } {
  const [flash, setFlash] = useState<Flash | null>(null);
  const nonce = useRef(0);
  const prev = useRef<Turn | undefined>(input.turn);

  useEffect(() => {
    const f = detectFlash(prev.current, input.turn);
    prev.current = input.turn;
    if (!f) return;
    nonce.current += 1;
    setFlash(f);
  }, [input.turn]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), FLASH_MS[flash]);
    return () => window.clearTimeout(id);
  }, [flash, nonce.current]); // eslint-disable-line react-hooks/exhaustive-deps

  return { presence: derivePresence({ ...input, flash }), nonce: nonce.current };
}
