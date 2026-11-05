// Steward's presence (DESIGN.md §7): one droid that shows what the assistant is doing. The state
// comes from lib/presence.ts; this file renders it and owns the timers of the flash states.
// Sub-agents bud off Steward's disc as liquid droplets (liquid-gooey) during an A2A handoff.

import { Liquid } from 'liquid-gooey';
import { useEffect, useRef } from 'react';

import { AgentAvatar, Orb } from '@/components/avatars';
import { useI18n } from '@/context/i18n';
import type { MessageKey } from '@/i18n';
import { useReducedMotion } from '@/lib/motion';
import type { AgentRole } from '@/lib/look';
import type { Presence } from '@/lib/presence';
import { cn } from '@/lib/utils';

const RIM: Record<string, string> = {
  allow: 'border-allow shadow-[0_0_0_1px_hsl(var(--allow)/0.6),0_0_22px_-4px_hsl(var(--allow)/0.7)]',
  approval: 'border-approval shadow-[0_0_0_1px_hsl(var(--approval)/0.6),0_0_22px_-4px_hsl(var(--approval)/0.7)]',
  deny: 'border-deny shadow-[0_0_0_1px_hsl(var(--deny)/0.6),0_0_22px_-4px_hsl(var(--deny)/0.7)]',
};

const SIZES = {
  // `bud`: where a sub-agent droplet settles relative to Steward's disc.
  hero: { disc: 112, body: 76, buddy: 40, buddyBody: 28, bud: { x: 84, y: -40 }, group: 'h-[112px] w-[112px]' },
  dock: { disc: 36, body: 24, buddy: 24, buddyBody: 16, bud: { x: 30, y: -27 }, group: 'h-9 w-9' },
} as const;

const COMPANIONS: Exclude<AgentRole, 'orchestrator'>[] = ['research', 'action'];

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

  // "Approved": one hop and a full turn (the avatar's own click reaction).
  useEffect(() => {
    if (p.gesture !== 'hop' || reduced) return;
    body.current?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, [p.gesture, nonce, reduced]);

  const gesture = reduced ? '' : p.gesture === 'shake' ? 'animate-presence-shake' : p.gesture === 'nod' ? 'animate-presence-nod' : '';
  const transition = reduced ? { duration: 0 } : ('smooth' as const);
  const agentLabel = (role: AgentRole) => t(`agent.${role}` as MessageKey);
  const status = t(p.label);
  const companion = p.companion ? `${agentLabel(p.companion.role)} · ${t('presence.companion')}` : null;

  return (
    <div
      data-testid="presence"
      data-presence={p.state}
      className={cn('flex items-center', variant === 'hero' ? 'flex-col gap-4' : 'gap-2.5', className)}
    >
      <Liquid
        blur={variant === 'hero' ? 7 : 5}
        contrast={18}
        filterPadding={64}
        fill="hsl(var(--accent))"
        className={cn('relative shrink-0 transition-opacity duration-layout', s.group, p.dimmed && 'opacity-45 grayscale')}
        aria-hidden
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
              style={{ left: (s.disc - s.buddy) / 2, top: `calc(50% - ${s.buddy / 2}px)` }}
            >
              <span
                className={cn('flex items-center justify-center rounded-full transition-opacity duration-enter', out ? 'opacity-100' : 'opacity-0')}
                style={{ width: s.buddy, height: s.buddy }}
              >
                {out && <AgentAvatar role={role} size={s.buddyBody} state={p.companion?.working ? 'working' : 'default'} />}
              </span>
            </Liquid.Item>
          );
        })}
        <Liquid.Item className="absolute left-0" style={{ top: `calc(50% - ${s.disc / 2}px)` }}>
          <span className={cn('relative flex items-center justify-center rounded-full', gesture)} style={{ width: s.disc, height: s.disc }} key={`${p.gesture}-${nonce}`}>
            <span
              className={cn(
                'pointer-events-none absolute inset-0 rounded-full border border-transparent transition-[border-color,box-shadow] duration-enter',
                p.rim && RIM[p.rim],
              )}
            />
            {p.orb && (
              <Orb
                state={p.orb}
                size={64}
                display={Math.round(s.disc * (variant === 'hero' ? 1.15 : 1.25))}
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
              interactive={variant === 'hero' && !p.frozen}
              pose={p.pose}
              glasses={p.glasses ? 'round' : 'none'}
              headphones={p.headphones}
              accessoryColor={p.glasses || p.headphones ? '#1a1a1a' : undefined}
              className="relative"
            />
          </span>
        </Liquid.Item>
      </Liquid>
      <p className={cn('min-w-0', variant === 'hero' ? 'sr-only' : 'truncate text-[13px] text-muted-foreground')}>
        <span className="font-medium text-foreground">{assistant}</span>
        <span aria-hidden> · </span>
        <span data-testid="presence-status">{status}</span>
        {p.glasses && <span className="hidden sm:inline"> · {t('presence.testAs')}</span>}
        {companion && <span className="hidden sm:inline"> · {companion}</span>}
      </p>
    </div>
  );
}
