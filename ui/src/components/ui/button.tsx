import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[6px] text-[13px] font-medium transition-colors duration-micro ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Inverted ink: the only "primary" color is the foreground itself (DESIGN.md §1).
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        destructive: 'bg-deny text-deny-ink hover:bg-deny/90',
        outline: 'border border-input bg-transparent text-foreground hover:border-foreground/40 hover:bg-accent',
        secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        link: 'text-foreground underline decoration-foreground/40 underline-offset-4 hover:decoration-foreground',
        // Approving is granting authority: the one button that wears a verdict color.
        allow: 'bg-allow text-allow-ink hover:bg-allow/90',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 gap-1.5 px-2.5 text-[12px]',
        lg: 'h-9 px-4 text-[13.5px]',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = 'Button';
