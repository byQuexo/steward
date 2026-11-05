// The libraries.dev components (DESIGN.md §8), wrapped once so theme and reduced motion are wired
// in one place: thinking-orbs (Orb), bot-avatars (AgentAvatar), border-beam (Beam) and metal-fx
// (BrandMark). The user avatar is a plain grey initials disc.

import { BorderBeam } from 'border-beam';
import { BotAvatar, type BotAvatarProps } from 'bot-avatars';
import { MetalFx } from 'metal-fx';
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';

import { AGENT_LOOK, EMBER, type AgentRole } from '@/lib/look';
import { useReducedMotion, useResolvedTheme } from '@/lib/motion';
import { cn, initials } from '@/lib/utils';

/**
 * The thinking orb. `size` is the tuned preset (64 / 32 / 20); `display` draws it at another CSS
 * size (used for the presence halo). Only a held call tints it (ember): color means Warden.
 */
export function Orb({
  state,
  size = 20,
  display,
  tint,
  label,
  className,
  style,
}: {
  state: OrbState;
  size?: 64 | 32 | 20;
  display?: number;
  tint?: 'approval';
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();
  const px = display ?? size;
  return (
    <ThinkingOrb
      state={state}
      size={size}
      theme={theme}
      paused={reduced}
      color={tint === 'approval' ? EMBER[theme] : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0', className)}
      style={{ width: px, height: px, ...style }}
    />
  );
}

type AgentAvatarProps = Omit<BotAvatarProps, 'type' | 'color' | 'theme'> & { role: AgentRole; label?: string };

/** A `bot-avatars` agent: still under reduced motion, non-interactive unless asked. */
export const AgentAvatar = forwardRef<HTMLCanvasElement, AgentAvatarProps>(function AgentAvatar(
  { role, label, size = 24, paused, interactive = false, className, ...rest },
  ref,
) {
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();
  const look = AGENT_LOOK[role];
  return (
    <BotAvatar
      ref={ref}
      type={look.type}
      color={look[theme]}
      theme={theme}
      shading="smooth"
      saturation={0}
      size={size}
      paused={reduced || paused}
      interactive={interactive && !reduced}
      jumpEvery={14}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0', className)}
      {...rest}
    />
  );
});

/**
 * Border beam. `held`: the ember beam on the first pending approval (something waits on a
 * human). `working`: a faint mono line under the composer while a turn runs. Off under reduced
 * motion; the static border of the child stays.
 */
export function Beam({ variant, active = true, children, className }: { variant: 'held' | 'working'; active?: boolean; children: ReactNode; className?: string }) {
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();
  const held = variant === 'held';
  return (
    <BorderBeam
      size={held ? 'md' : 'line'}
      colorVariant={held ? 'gold' : 'mono'}
      staticColors={held}
      theme={theme}
      strength={held ? (theme === 'dark' ? 0.9 : 0.75) : 0.45}
      duration={held ? 3.2 : 2.6}
      active={active && !reduced}
      className={cn('block', className)}
    >
      {children}
    </BorderBeam>
  );
}

function GateGlyph({ className }: { className?: string }) {
  // Steward's mark: a gate (two pillars) with a token passing through.
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className} fill="currentColor">
      <rect x="9" y="8" width="3" height="16" rx="1.5" />
      <rect x="20" y="8" width="3" height="16" rx="1.5" />
      <rect x="14" y="14" width="4" height="4" rx="1" />
    </svg>
  );
}

/** The Steward mark. `metal`: a liquid-metal ring (brand mark only, never on content). */
export function BrandMark({ size = 28, metal, className }: { size?: number; metal?: 'hero' | 'bar'; className?: string }) {
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();
  const disc = (glyph: boolean) => (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full border bg-card text-foreground', className)}
      style={{ width: size, height: size }}
    >
      {glyph && <GateGlyph className="h-[62%] w-[62%]" />}
    </span>
  );
  if (!metal) return disc(true);
  // The glyph sits above the metal canvas, so the mark never depends on WebGL painting.
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <MetalFx variant="circle" preset="silver" theme={theme} paused={reduced} strength={metal === 'hero' ? 0.85 : 0.6} aria-hidden>
        {disc(false)}
      </MetalFx>
      <span aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-foreground">
        <GateGlyph className="h-[62%] w-[62%]" />
      </span>
    </span>
  );
}

/** People are grey initials discs; only agents get bodies. */
export function UserAvatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full border bg-muted font-medium text-foreground', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}
