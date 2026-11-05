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
      <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6">
        <PageHeader title={t('console.title')} />
        <Alert variant="denied">{t('console.forbidden')}</Alert>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
      <PageHeader title={t('console.title')} description={t('console.subtitle')} />
      <div className="lg:grid lg:grid-cols-[184px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label={t('console.nav')} className="no-scrollbar -mx-4 mb-5 overflow-x-auto border-b px-4 lg:sticky lg:top-4 lg:mx-0 lg:mb-0 lg:self-start lg:overflow-visible lg:border-b-0 lg:px-0">
          <ul className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col lg:gap-0.5">
            {sections.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'relative -mb-px inline-flex items-center gap-2 border-b px-2.5 py-2 text-[13px] transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:mb-0 lg:flex lg:h-7 lg:w-full lg:rounded-[4px] lg:border-b-0 lg:py-0',
                      isActive
                        ? 'border-foreground text-foreground lg:bg-accent lg:before:absolute lg:before:-left-2 lg:before:top-1.5 lg:before:h-4 lg:before:w-px lg:before:bg-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground lg:hover:bg-accent/50',
                    )
                  }
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {t(label)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
