'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-white hover:bg-ink-soft',
        secondary: 'bg-ink-panel text-ink hover:bg-ink-line/60',
        ghost: 'text-ink hover:bg-ink-panel',
        outline: 'border border-ink-line bg-white text-ink hover:bg-ink-panel',
        danger: 'text-red-600 hover:bg-red-50',
      },
      size: {
        sm: 'h-10 min-w-10 px-3 text-sm sm:h-7 sm:min-w-0 sm:px-2.5 sm:text-xs',
        md: 'h-10 min-w-10 px-3 text-sm sm:min-w-0 sm:h-8',
        lg: 'h-10 min-w-10 px-4 text-base sm:min-w-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';
