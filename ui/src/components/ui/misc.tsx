import { AlertTriangle, Ban, Clock, Info } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden {...props} />;
}

export function Separator({ className, ...props }: React.HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn('border-0 border-t border-border', className)} {...props} />;
}

// info / warning / error are monochrome: they are not Warden decisions. An error is a *fault*
// (dashed hairline), never red. `held` and `denied` are verdicts and wear their color (DESIGN.md §1).
const alertStyles = {
  info: 'border-border bg-transparent text-foreground [&>svg]:text-muted-foreground',
  warning: 'border-foreground/25 bg-muted/60 text-foreground [&>svg]:text-foreground',
  error: 'border-dashed border-foreground/35 bg-transparent text-foreground [&>svg]:text-foreground',
  held: 'border-approval/45 bg-approval-soft text-approval-foreground',
  denied: 'border-deny/40 bg-deny-soft text-deny-foreground',
} as const;

const alertIcons = { info: Info, warning: AlertTriangle, error: AlertTriangle, held: Clock, denied: Ban } as const;

export function Alert({
  variant = 'info',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: keyof typeof alertStyles }) {
  const Icon = alertIcons[variant];
  return (
    <div className={cn('flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm', alertStyles[variant], className)} {...props}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Page header: mono eyebrow, title, description, optional actions. Left-aligned, hairline below. */
export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
        <h1 className="text-[28px] font-medium leading-tight tracking-[-0.03em] sm:text-[32px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Section heading inside a page: mono eyebrow style with an optional count. */
export function SectionTitle({ id, children, count, tone }: { id?: string; children: React.ReactNode; count?: number; tone?: 'approval' }) {
  return (
    <h2 id={id} className="mb-4 flex items-center gap-2.5 font-mono text-eyebrow font-medium uppercase text-muted-foreground">
      {children}
      {count != null && count > 0 && (
        <span
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums tracking-normal',
            tone === 'approval' ? 'bg-approval text-approval-ink' : 'bg-muted text-foreground',
          )}
        >
          {count}
        </span>
      )}
    </h2>
  );
}

/** Small key/value code block for tool arguments. */
export function ArgsTable({ args, label }: { args: unknown; label?: string }) {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const entries = Object.entries(args as Record<string, unknown>);
    if (entries.length === 0) return <code className="font-mono text-xs text-muted-foreground">{'{}'}</code>;
    return (
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 font-mono text-[12.5px]" aria-label={label}>
        {entries.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words tabular-nums text-foreground">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
    );
  }
  return <code className="font-mono text-xs">{JSON.stringify(args)}</code>;
}

/** Empty state with purpose: what appears here and how to make it appear. */
export function EmptyNote({ icon: Icon, children, className }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border border-dashed px-5 py-6 text-sm text-muted-foreground', className)}>
      {Icon && (
        <span aria-hidden className="mt-0.5 shrink-0">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
