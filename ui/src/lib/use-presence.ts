import { useEffect, useRef, useState } from 'react';

import { derivePresence, detectFlash, FLASH_MS, type Flash, type Presence, type PresenceInput } from './presence';
import type { Turn } from './timeline';

/** Seconds without input before Steward dozes off. */
export const DOZE_AFTER_MS = 60_000;

/**
 * Derive the presence and keep its timers: flash states (deny, approved, done), dozing after a
 * minute without input (any key, click or wheel wakes him), and an occasional glance at the
 * composer while idle. With `reduced` there is no glancing (the still pose stays).
 */
export function usePresence(input: Omit<PresenceInput, 'flash' | 'dozing' | 'glance'>, reduced = false): { presence: Presence; nonce: number; wake: () => void } {
  const [flash, setFlash] = useState<Flash | null>(null);
  const [dozing, setDozing] = useState(false);
  const [glance, setGlance] = useState(false);
  const nonce = useRef(0);
  const prev = useRef<Turn | undefined>(input.turn);
  const dozeTimer = useRef<number>();

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

  // Dozing: restart the countdown on any input, and whenever the conversation changes.
  const wakeRef = useRef<() => void>(() => {});
  wakeRef.current = () => {
    setDozing(false);
    window.clearTimeout(dozeTimer.current);
    dozeTimer.current = window.setTimeout(() => setDozing(true), DOZE_AFTER_MS);
  };
  useEffect(() => {
    const wake = () => wakeRef.current();
    wake();
    const events = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, wake));
      window.clearTimeout(dozeTimer.current);
    };
  }, []);
  useEffect(() => wakeRef.current(), [input.turn, input.typing]);

  const presence = derivePresence({ ...input, flash, dozing, glance });
  const idle = presence.state === 'idle';

  // Idle micro-life: now and then a short look down at the composer.
  useEffect(() => {
    if (!idle || reduced) return;
    let t1 = 0;
    let t2 = 0;
    const schedule = () => {
      t1 = window.setTimeout(
        () => {
          setGlance(true);
          t2 = window.setTimeout(() => {
            setGlance(false);
            schedule();
          }, 1400);
        },
        12_000 + Math.random() * 10_000,
      );
    };
    schedule();
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      setGlance(false);
    };
  }, [idle, reduced]);

  return { presence, nonce: nonce.current, wake: () => wakeRef.current() };
}
