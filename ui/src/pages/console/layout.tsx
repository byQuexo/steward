import { Activity, OctagonPause, Plug, ScrollText, ShieldQuestion, UserRoundCog, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

import { Alert, PageHeader } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import { useMe } from '@/context/session';
import type { MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';

const sections: { to: string; label: MessageKey; icon: typeof Activity }[] = [
  { to: 'effective', label: 'console.effective', icon: ShieldQuestion },
  { to: 'test-as', label: 'console.testAs', icon: UserRoundCog },
  { to: 'users', label: 'console.users', icon: Users },
  { to: 'audit', label: 'console.audit', icon: ScrollText },
  { to: 'kill', label: 'console.kill', icon: OctagonPause },
  { to: 'connectors', label: 'console.connectors', icon: Plug },
];

export function ConsoleLayout() {
  const me = useMe();
  const { t } = useI18n();
  if (!me.admin) {
    return (
      <div className="container max-w-3xl py-8">
        <PageHeader title={t('console.title')} />
        <Alert variant="warning">{t('console.forbidden')}</Alert>
      </div>
    );
  }
  return (
    <div className="container max-w-6xl py-8">
      <PageHeader title={t('console.title')} description={t('console.subtitle')} />
      <nav aria-label={t('console.nav')} className="mb-6 overflow-x-auto border-b">
        <ul className="flex min-w-max gap-1">
          {sections.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {t(label)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
