// Steward's presence (DESIGN.md §7): one droid that is there with you. Large in the empty
// state, on a "stage" next to the conversation on wide screens, inside the composer on narrow
// ones. The state comes from lib/presence.ts (pure); timers live in lib/use-presence.ts.
// Sub-agents bud off Steward's disc as liquid droplets (liquid-gooey) during A2A handoffs.

import { Liquid } from 'liquid-gooey';
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';

import { AgentAvatar, Orb } from '@/components/avatars';
import { useI18n } from '@/context/i18n';
import type { AgentRole } from '@/lib/look';
import { useReducedMotion } from '@/lib/motion';
import type { Look, Presence } from '@/lib/presence';
import { cn } from '@/lib/utils';

export type PresenceVariant = 'hero' | 'stage' | 'inline';

const RIM: Record<string, string> = {
  allow: 'border-allow shadow-[0_0_0_1px_hsl(var(--allow)/0.45),0_0_28px_-6px_hsl(var(--allow)/0.7)]',
  approval: 'border-approval shadow-[0_0_0_1px_hsl(var(--approval)/0.45),0_0_28px_-6px_hsl(var(--approval)/0.7)]',
  deny: 'border-deny shadow-[0_0_0_1px_hsl(var(--deny)/0.45),0_0_28px_-6px_hsl(var(--deny)/0.7)]',
};

const SIZES = {
  // `bud`: where a sub-agent droplet settles relative to Steward's disc.
  hero: { disc: 184, body: 156, buddy: 52, buddyBody: 38, bud: { x: 150, y: -40 }, orb: 64 as const },
  stage: { disc: 140, body: 112, buddy: 44, buddyBody: 32, bud: { x: 104, y: -54 }, orb: 64 as const },
  inline: { disc: 40, body: 30, buddy: 22, buddyBody: 16, bud: { x: 26, y: -26 }, orb: 32 as const },
} as const;

/** Head poses per layout: where the composer, the gate and the user are, seen from Steward. */
const POSES: Record<PresenceVariant, Record<Look, { yaw: number; pitch: number }>> = {
  hero: { composer: { yaw: 0, pitch: -0.42 }, gate: { yaw: 0, pitch: -0.3 }, user: { yaw: 0, pitch: 0 } },
  stage: { composer: { yaw: 0.38, pitch: -0.32 }, gate: { yaw: 0.46, pitch: 0.04 }, user: { yaw: 0, pitch: 0 } },
  inline: { composer: { yaw: 0.42, pitch: 0 }, gate: { yaw: 0.3, pitch: 0.36 }, user: { yaw: 0, pitch: 0 } },
};

const COMPANIONS: Exclude<AgentRole, 'orchestrator'>[] = ['research', 'action'];

/** Steward's body: liquid disc, verdict rim, thinking-orb halo, droid. Clicking him pokes him. */
export function PresenceAvatar({
  presence: p,
  nonce,
  variant,
  assistant,
  onPoke,
  className,
}: {
  presence: Presence;
  nonce: number;
  variant: PresenceVariant;
  assistant: string;
  onPoke?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const body = useRef<HTMLCanvasElement>(null);
  const s = SIZES[variant];

  // "Approved": one hop and a full turn (the avatar's own click reaction).
  useEffect(() => {
    if (p.gesture !== 'hop' || reduced) return;
    body.current?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }));
  }, [p.gesture, nonce, reduced]);

  const poke = (e: MouseEvent<HTMLButtonElement>) => {
    // Keyboard activation: let the body hop as if clicked (its own click reaction).
    if (e.target !== body.current && body.current && !reduced && !p.frozen) {
      body.current.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }));
      return;
    }
    onPoke?.();
  };

  const gesture = reduced ? '' : p.gesture === 'shake' ? 'animate-presence-shake' : p.gesture === 'nod' ? 'animate-presence-nod' : '';
  const transition = reduced ? { duration: 0 } : ('smooth' as const);
  const pose = p.look && !reduced ? POSES[variant][p.look] : undefined;

  return (
    <div data-testid="presence" data-presence={p.state} className={cn('relative shrink-0', className)} style={{ width: s.disc, height: s.disc }}>
      <Liquid
        blur={variant === 'inline' ? 4 : 7}
        contrast={18}
        filterPadding={80}
        fill="hsl(var(--accent))"
        className={cn('relative h-full w-full transition-opacity duration-layout', p.dimmed && 'opacity-45 grayscale')}
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
                size={s.orb}
                display={Math.round(s.disc * 1.18)}
                tint={p.orb === 'breathing' ? 'approval' : undefined}
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-60"
              />
            )}
            <AgentAvatar
              ref={body}
              role="orchestrator"
              size={s.body}
              state={p.avatar}
              paused={p.frozen}
              interactive={!p.frozen}
              pose={pose}
              glasses={p.glasses ? 'round' : 'none'}
              accessoryColor={p.glasses ? '#1a1a1a' : undefined}
              className="relative"
            />
          </button>
        </Liquid.Item>
      </Liquid>
    </div>
  );
}

/**
 * The caption attached to Steward: a hairline box with a small notch pointing at him, like he
 * is speaking (no cartoon bubble). Lines fade in, one at a time.
 */
export function PresenceCaption({ children, className, align = 'center' }: { children: ReactNode; className?: string; align?: 'center' | 'left' }) {
  return (
    <div className={cn('relative rounded-[10px] border bg-card px-3.5 py-2.5', align === 'center' ? 'text-center' : 'text-left', className)}>
      <span
        aria-hidden
        className={cn('absolute -top-[5px] h-2.5 w-2.5 rotate-45 border-l border-t bg-card', align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-6')}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
