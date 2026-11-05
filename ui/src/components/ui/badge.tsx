import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex h-[18px] items-center gap-1 rounded-[4px] border px-1.5 text-[11px] font-medium leading-none whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        muted: 'border-border bg-muted text-muted-foreground',
        // Verdicts: the only colored badges (DESIGN.md §2).
        allow: 'border-allow/35 bg-allow-soft text-allow-foreground',
        approval: 'border-approval/45 bg-approval-soft text-approval-foreground',
        deny: 'border-deny/40 bg-deny-soft text-deny-foreground',
        info: 'border-foreground/25 bg-transparent text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
