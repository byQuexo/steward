import { useId } from 'react';

import { cn, hash, initials } from '@/lib/utils';

/**
 * A generated, deterministic bot avatar: the same agent id always gets the same face, different
 * agents (orchestrator, research, action) are easy to tell apart in the activity timeline.
 */
export function BotAvatar({ seed, size = 32, className, title }: { seed: string; size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  const h = hash(seed);
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + ((h >>> 9) % 80)) % 360;
  const eyes = (h >>> 3) % 3; // 0 round, 1 tall, 2 square
  const mouth = (h >>> 5) % 3; // 0 smile, 1 flat, 2 dots
  const antenna = ((h >>> 7) & 1) === 1;
  const ear = ((h >>> 11) & 1) === 1;
  const eye = (cx: number) =>
    eyes === 0 ? (
      <circle cx={cx} cy={17.5} r={2.3} fill="white" />
    ) : eyes === 1 ? (
      <rect x={cx - 1.6} y={15} width={3.2} height={5.2} rx={1.6} fill="white" />
    ) : (
      <rect x={cx - 2.1} y={15.4} width={4.2} height={4.2} rx={1} fill="white" />
    );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue1} 70% 55%)`} />
          <stop offset="1" stopColor={`hsl(${hue2} 65% 42%)`} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#g${id})`} />
      {antenna && (
        <>
          <line x1="16" y1="4" x2="16" y2="8" stroke="white" strokeOpacity="0.8" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="16" cy="3.6" r="1.6" fill="white" />
        </>
      )}
      {ear && (
        <>
          <rect x="3" y="14" width="2.4" height="7" rx="1.2" fill="white" fillOpacity="0.6" />
          <rect x="26.6" y="14" width="2.4" height="7" rx="1.2" fill="white" fillOpacity="0.6" />
        </>
      )}
      <rect x="6.5" y="9.5" width="19" height="16" rx="5.5" fill="black" fillOpacity="0.22" />
      {eye(12)}
      {eye(20)}
      {mouth === 0 && <path d="M12.5 22c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5" stroke="white" strokeWidth="1.4" fill="none" strokeLinecap="round" />}
      {mouth === 1 && <line x1="13" y1="22.6" x2="19" y2="22.6" stroke="white" strokeWidth="1.4" strokeLinecap="round" />}
      {mouth === 2 && (
        <>
          <circle cx="14" cy="22.6" r="0.9" fill="white" />
          <circle cx="16" cy="22.6" r="0.9" fill="white" />
          <circle cx="18" cy="22.6" r="0.9" fill="white" />
        </>
      )}
    </svg>
  );
}

export function UserAvatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const hue = hash(name) % 360;
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 50% 28%)` }}
    >
      {initials(name)}
    </span>
  );
}

/** The thinking orb: animated while `active`, a calm static sphere otherwise. */
export function ThinkingOrb({ active = true, size = 28, className }: { active?: boolean; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('thinking-orb', !active && 'is-idle', className)}
      style={{ ['--orb-size' as string]: `${size}px` }}
    />
  );
}
