import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Tokens live in src/index.css (see DESIGN.md §2). Everything is grey except the three verdict
// colors (allow / approval "ember" / deny): color means Warden decided something.
const color = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1280px' } },
    extend: {
      fontFamily: {
        sans: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Cascadia Code', 'Consolas', 'Menlo', 'monospace'],
      },
      fontSize: {
        eyebrow: ['0.65625rem', { lineHeight: '1rem', letterSpacing: '0.08em' }],
      },
      colors: {
        border: color('border'),
        input: color('input'),
        ring: color('ring'),
        background: color('background'),
        foreground: color('foreground'),
        subtle: color('subtle'),
        primary: { DEFAULT: color('primary'), foreground: color('primary-foreground') },
        secondary: { DEFAULT: color('secondary'), foreground: color('secondary-foreground') },
        muted: { DEFAULT: color('muted'), foreground: color('muted-foreground') },
        accent: { DEFAULT: color('accent'), foreground: color('accent-foreground') },
        destructive: { DEFAULT: color('destructive'), foreground: color('destructive-foreground') },
        card: { DEFAULT: color('card'), foreground: color('card-foreground') },
        popover: { DEFAULT: color('popover'), foreground: color('popover-foreground') },
        allow: { DEFAULT: color('allow'), soft: color('allow-soft'), foreground: color('allow-foreground'), ink: color('allow-ink') },
        approval: { DEFAULT: color('approval'), soft: color('approval-soft'), foreground: color('approval-foreground'), ink: color('approval-ink') },
        deny: { DEFAULT: color('deny'), soft: color('deny-soft'), foreground: color('deny-foreground'), ink: color('deny-ink') },
        chart: {
          1: color('chart-1'),
          2: color('chart-2'),
          3: color('chart-3'),
          4: color('chart-4'),
          5: color('chart-5'),
        },
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 2px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        'in-out': 'cubic-bezier(0.6, 0, 0.2, 1)',
      },
      transitionDuration: {
        micro: '120ms',
        enter: '220ms',
        layout: '320ms',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'presence-shake': {
          '0%, 100%': { transform: 'none' },
          '15%': { transform: 'translateX(-3px) rotate(-6deg)' },
          '35%': { transform: 'translateX(3px) rotate(6deg)' },
          '55%': { transform: 'translateX(-2px) rotate(-4deg)' },
          '75%': { transform: 'translateX(1px) rotate(2deg)' },
        },
        'presence-nod': {
          '0%, 100%': { transform: 'none' },
          '30%': { transform: 'translateY(2px) rotate(-1deg)' },
          '60%': { transform: 'translateY(-1px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'presence-shake': 'presence-shake 800ms cubic-bezier(0.6, 0, 0.2, 1) both',
        'presence-nod': 'presence-nod 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
