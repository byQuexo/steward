import { Brain, Inbox, LogOut, Menu, MessageSquare, OctagonPause, ShieldCheck, UserRoundCog, Wallet, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { UserAvatar } from '@/components/avatars';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/context/i18n';
import { useLive } from '@/context/live';
import { useMe, useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import type { MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { cn, errorMessage } from '@/lib/utils';

interface NavItem {
  to: string;
  label: MessageKey;
  icon: LucideIcon;
  end?: boolean;
  badge?: number;
}

function TestAsBanner() {
  const me = useMe();
  const { refresh } = useSession();
  const { t } = useI18n();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!me.impersonated_by) return null;
  const end = async () => {
    setBusy(true);
    try {
      await api.endTestAs();
      await refresh();
      navigate('/console/test-as');
    } catch (e) {
      toast(t('common.error', { error: errorMessage(e) }), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="region" aria-label={t('banner.testAs', { name: me.name })} className="bg-approval text-[hsl(30_60%_10%)]" data-testid="test-as-banner">
      <div className="container flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <UserRoundCog className="h-4 w-4" aria-hidden />
          {t('banner.testAs', { name: me.name })}
          <span className="font-normal opacity-80">({t('banner.testAsBy', { admin: me.impersonated_by })})</span>
        </p>
        <Button size="sm" variant="outline" className="border-black/30 bg-white/80 text-black hover:bg-white" onClick={end} disabled={busy}>
          {t('banner.testAsEnd')}
        </Button>
      </div>
    </div>
  );
}

function KillBanner() {
  const me = useMe();
  const { t } = useI18n();
  if (me.kill_switch === 'off') return null;
  const text = t(me.kill_switch === 'all' ? 'banner.kill.all' : 'banner.kill.writes');
  return (
    <div role="region" aria-label={t('console.kill')} className="bg-deny text-white dark:text-[hsl(0_60%_10%)]" data-testid="kill-banner">
      <p className="container flex items-center gap-2 py-2 text-sm font-medium">
        <OctagonPause className="h-4 w-4" aria-hidden />
        {text}
      </p>
    </div>
  );
}

export function AppShell() {
  const me = useMe();
  const { info, logout } = useSession();
  const { toDecide } = useLive();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  const items: NavItem[] = [
    { to: '/', label: 'nav.chat', icon: MessageSquare, end: true },
    { to: '/approvals', label: 'nav.approvals', icon: Inbox, badge: toDecide },
    { to: '/memory', label: 'nav.memory', icon: Brain },
    { to: '/costs', label: 'nav.costs', icon: Wallet },
  ];
  if (me.admin) items.push({ to: '/console', label: 'nav.console', icon: ShieldCheck });

  const nav = (mobile: boolean) => (
    <ul className={cn(mobile ? 'flex flex-col gap-1 p-2' : 'flex items-center gap-1')}>
      {items.map(({ to, label, icon: Icon, end, badge }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'relative inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden />
            {t(label)}
            {badge ? (
              <span
                className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-approval px-1.5 text-[11px] font-semibold text-[hsl(30_60%_10%)] md:ml-0"
                data-testid="approvals-badge"
              >
                <span aria-hidden>{badge}</span>
                <span className="sr-only">{t('nav.approvalsBadge', { count: badge })}</span>
              </span>
            ) : null}
          </NavLink>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        {t('app.skip')}
      </a>
      <TestAsBanner />
      <KillBanner />
      <header className="shrink-0 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <div className="container flex h-14 items-center gap-3">
          <NavLink to="/" className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="flex flex-col leading-none">
              <span className="text-sm font-semibold">{info?.company ?? me.company}</span>
              <span className="text-[11px] text-muted-foreground">{t('app.name')}</span>
            </span>
          </NavLink>
          <nav aria-label={t('nav.main')} className="ml-4 hidden md:block">
            {nav(false)}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <div className="hidden items-center gap-2 border-l pl-3 sm:flex" title={t('user.menu', { name: me.name })}>
              <UserAvatar name={me.name} size={28} />
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-medium">{me.name}</span>
                <span className="text-[11px] text-muted-foreground">{me.roles.join(', ')}</span>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => void logout()} aria-label={t('user.logout')} title={t('user.logout')}>
              <LogOut aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? t('nav.closeMenu') : t('nav.openMenu')}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X aria-hidden /> : <Menu aria-hidden />}
            </Button>
          </div>
        </div>
        {open && (
          <nav id="mobile-nav" aria-label={t('nav.main')} className="border-t md:hidden">
            {nav(true)}
          </nav>
        )}
      </header>
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-y-auto focus:outline-none">
        <Outlet />
      </main>
    </div>
  );
}
