// Steward's presence (DESIGN.md §7): one droid that shows what the assistant is doing and says
// so in first person. The state comes from lib/presence.ts (pure); timers live in
// lib/use-presence.ts. Sub-agents bud off Steward's disc as liquid droplets (liquid-gooey).

import { Liquid } from 'liquid-gooey';
import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { AgentAvatar, Orb } from '@/components/avatars';
import { useI18n } from '@/context/i18n';
import { useMe } from '@/context/session';
import type { AgentRole } from '@/lib/look';
import { useReducedMotion } from '@/lib/motion';
import type { Line, Presence } from '@/lib/presence';
import { cn } from '@/lib/utils';

const RIM: Record<string, string> = {
  allow: 'border-allow shadow-[0_0_0_1px_hsl(var(--allow)/0.5),0_0_14px_-3px_hsl(var(--allow)/0.7)]',
  approval: 'border-approval shadow-[0_0_0_1px_hsl(var(--approval)/0.5),0_0_14px_-3px_hsl(var(--approval)/0.7)]',
  deny: 'border-deny shadow-[0_0_0_1px_hsl(var(--deny)/0.5),0_0_14px_-3px_hsl(var(--deny)/0.7)]',
};

const SIZES = {
  // `bud`: where a sub-agent droplet settles relative to Steward's disc.
  hero: { disc: 80, body: 60, buddy: 32, buddyBody: 22, bud: { x: 62, y: -30 }, group: 'h-20 w-20' },
  dock: { disc: 28, body: 20, buddy: 20, buddyBody: 14, bud: { x: 24, y: -20 }, group: 'h-7 w-7' },
} as const;

const COMPANIONS: Exclude<AgentRole, 'orchestrator'>[] = ['research', 'action'];

/** Short lines Steward says when poked: what he can do for this user. */
function usePokeLines(): Line[] {
  const me = useMe();
  const lines: Line[] = [];
  if (me.tools.length) lines.push({ key: 'presence.click.tools', vars: { count: me.tools.length, tools: me.tools.slice(0, 3).join(', ') } });
  for (const s of me.suggestions.slice(0, 2)) lines.push({ key: 'presence.click.try', vars: { suggestion: s } });
  lines.push({ key: 'presence.click.warden' });
  return lines;
}

export function PresenceView({
  presence: p,
  nonce,
  variant,
  assistant,
  className,
}: {
  presence: Presence;
  nonce: number;
  variant: 'hero' | 'dock';
  assistant: string;
  className?: string;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const body = useRef<HTMLCanvasElement>(null);
  const s = SIZES[variant];
  const pokeLines = usePokeLines();
  const [poked, setPoked] = useState<{ line: Line; n: number } | null>(null);
  const lastPoke = useRef(-1);

  // "Approved": one hop and a full turn (the avatar's own click reaction).
  useEffect(() => {
    if (p.gesture !== 'hop' || reduced) return;
    body.current?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }));
  }, [p.gesture, nonce, reduced]);

  useEffect(() => {
    if (!poked) return;
    const id = window.setTimeout(() => setPoked(null), 4500);
    return () => window.clearTimeout(id);
  }, [poked]);

  // A real state change wins over a poke line.
  useEffect(() => setPoked(null), [p.state]);

  const poke = (e: MouseEvent<HTMLButtonElement>) => {
    // Keyboard activation: let the body hop as if clicked (its own click reaction).
    if (e.target !== body.current && body.current && !reduced && !p.frozen) {
      body.current.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }));
      return;
    }
    let i = Math.floor(Math.random() * pokeLines.length);
    if (pokeLines.length > 1 && i === lastPoke.current) i = (i + 1) % pokeLines.length;
    lastPoke.current = i;
    const line = pokeLines[i];
    if (line) setPoked((x) => ({ line, n: (x?.n ?? 0) + 1 }));
  };

  const gesture = reduced ? '' : p.gesture === 'shake' ? 'animate-presence-shake' : p.gesture === 'nod' ? 'animate-presence-nod' : '';
  const transition = reduced ? { duration: 0 } : ('smooth' as const);
  const line = poked?.line ?? p.say;
  const text = t(line.key, line.vars);
  const showLine = variant === 'dock' || !!poked || (p.state !== 'idle' && p.state !== 'denied');

  return (
    <div data-testid="presence" data-presence={p.state} className={cn('flex items-center', variant === 'hero' ? 'flex-col gap-3' : 'gap-2.5', className)}>
      <Liquid
        blur={variant === 'hero' ? 6 : 4}
        contrast={18}
        filterPadding={56}
        fill="hsl(var(--accent))"
        className={cn('relative shrink-0 transition-opacity duration-layout', s.group, p.dimmed && 'opacity-45 grayscale')}
      >
        {COMPANIONS.map((role) => {
          const out = p.companion?.role === role;
          return (
            <Liquid.Item
              key={role}
              x={out ? s.bud.x : 0}
              y={out ? s.bud.y : 0}
              scale={out ? 1 : 0.35}
              transition={transition}
              className="absolute"
              style={{ left: (s.disc - s.buddy) / 2, top: (s.disc - s.buddy) / 2 }}
            >
              <span
                aria-hidden
                className={cn('flex items-center justify-center rounded-full transition-opacity duration-enter', out ? 'opacity-100' : 'opacity-0')}
                style={{ width: s.buddy, height: s.buddy }}
              >
                {out && <AgentAvatar role={role} size={s.buddyBody} state={p.companion?.working ? 'working' : 'default'} />}
              </span>
            </Liquid.Item>
          );
        })}
        <Liquid.Item className="absolute left-0 top-0">
          <button
            type="button"
            onClick={poke}
            aria-label={t('presence.poke', { assistant })}
            title={t('presence.poke', { assistant })}
            className={cn('relative flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', gesture)}
            style={{ width: s.disc, height: s.disc }}
            key={`${p.gesture}-${nonce}`}
          >
            <span aria-hidden className={cn('pointer-events-none absolute inset-0 rounded-full border border-transparent transition-[border-color,box-shadow] duration-enter', p.rim && RIM[p.rim])} />
            {p.orb && (
              <Orb
                state={p.orb}
                size={variant === 'hero' ? 64 : 32}
                display={Math.round(s.disc * 1.2)}
                tint={p.orb === 'breathing' ? 'approval' : undefined}
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-70"
              />
            )}
            <AgentAvatar
              ref={body}
              role="orchestrator"
              size={s.body}
              state={p.avatar}
              paused={p.frozen}
              interactive={!p.frozen}
              pose={p.pose}
              glasses={p.glasses ? 'round' : 'none'}
              headphones={p.headphones}
              accessoryColor={p.glasses || p.headphones ? '#1a1a1a' : undefined}
              className="relative"
            />
          </button>
        </Liquid.Item>
      </Liquid>
      <p
        className={cn(
          'min-w-0 text-[12.5px] leading-5',
          variant === 'hero' ? 'h-5 text-center text-muted-foreground' : 'flex items-baseline gap-2 truncate',
        )}
      >
        {variant === 'dock' && <span className="font-medium text-foreground">{assistant}</span>}
        {variant === 'hero' && <span className="sr-only">{assistant}: </span>}
        {showLine && (
          <span key={`${line.key}-${poked?.n ?? 0}-${text}`} className="animate-fade-in truncate text-muted-foreground" data-testid="presence-line">
            {text}
          </span>
        )}
      </p>
    </div>
  );
}
