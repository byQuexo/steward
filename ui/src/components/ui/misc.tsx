import { AlertTriangle, Info, XCircle } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden {...props} />;
}

export function Separator({ className, ...props }: React.HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn('border-0 border-t border-border', className)} {...props} />;
}

const alertStyles = {
  info: 'border-primary/25 bg-accent text-accent-foreground',
  warning: 'border-approval/40 bg-approval-soft text-approval-foreground',
  error: 'border-deny/30 bg-deny-soft text-deny-foreground',
} as const;

const alertIcons = { info: Info, warning: AlertTriangle, error: XCircle } as const;

export function Alert({
  variant = 'info',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: keyof typeof alertStyles }) {
  const Icon = alertIcons[variant];
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm', alertStyles[variant], className)} {...props}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Page header: title + description + optional actions. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Small key/value code block for tool arguments. */
export function ArgsTable({ args, label }: { args: unknown; label?: string }) {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const entries = Object.entries(args as Record<string, unknown>);
    if (entries.length === 0) return <code className="font-mono text-xs text-muted-foreground">{'{}'}</code>;
    return (
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-xs" aria-label={label}>
        {entries.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words font-medium">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
    );
  }
  return <code className="font-mono text-xs">{JSON.stringify(args)}</code>;
}
