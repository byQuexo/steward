import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/context/i18n';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'steward.theme';

// Dark is the default (DESIGN.md §2); light and "follow the system" are opt-in.
function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    apply(theme);
    try {
      if (theme === 'dark') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* private mode */
    }
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const next: Record<Theme, Theme> = { dark: 'light', light: 'system', system: 'dark' };
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const label = t(`theme.${theme}`);
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next[theme])} aria-label={`${t('theme.toggle')} (${label})`} title={`${t('theme.toggle')} (${label})`}>
      <Icon aria-hidden />
    </Button>
  );
}
