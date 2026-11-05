// Theme and motion preferences for the libraries.dev components (orbs, avatars, beams, metal),
// which take `theme` / `paused` / `active` props instead of reading our CSS (DESIGN.md §5, §8).

import { useEffect, useState } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

function prefersReduced(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED).matches;
}

/** True when the user asked for no motion: every orb/avatar is paused, every beam inactive. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReduced);
  useEffect(() => {
    const mq = window.matchMedia?.(REDUCED);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export type ResolvedTheme = 'dark' | 'light';

function currentTheme(): ResolvedTheme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** The theme actually applied (`html.dark`), live: follows the theme toggle and the OS. */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(currentTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setTheme(currentTheme());
    return () => obs.disconnect();
  }, []);
  return theme;
}

/** A media query, live. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}
