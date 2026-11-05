import { LogOut, Menu, OctagonPause, UserRoundCog, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { BrandMark } from '@/components/avatars';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/context/i18n';
import { useLive } from '@/context/live';
import { useMe, useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import type { MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { cn, errorMessage, initials } from '@/lib/utils';

interface NavItem {
  to: string;
  label: MessageKey;
  end?: boolean;
  badge?: number;
}

/** Test-as indicator in the header: inverted ink (not a verdict), with "end". */
function TestAsIndicator() {
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
  const full = `${t('banner.testAs', { name: me.name })} (${t('banner.testAsBy', { admin: me.impersonated_by })})`;
  return (
    <div role="region" aria-label={full} title={full} data-testid="test-as-banner" className="flex h-6 items-center gap-1.5 rounded-[5px] bg-foreground pl-2 pr-0.5 text-[12px] text-background">
      <UserRoundCog className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden max-w-[16rem] truncate sm:inline">{t('banner.testAsShort', { name: me.name })}</span>
      <button
        type="button"
        onClick={end}
        disabled={busy}
        className="h-5 rounded-[4px] px-1.5 text-[11.5px] font-medium hover:bg-background/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background"
      >
        {t('banner.testAsEnd')}
      </button>
    </div>
  );
}

/** Kill-switch indicator: Warden denying (some or) everything, the loudest red there is. */
function KillIndicator() {
  const me = useMe();
  const { t } = useI18n();
  if (me.kill_switch === 'off') return null;
  const full = t(me.kill_switch === 'all' ? 'banner.kill.all' : 'banner.kill.writes');
  return (
    <NavLink
      to="/console/kill"
      aria-label={full}
      title={full}
      data-testid="kill-banner"
      className="flex h-6 items-center gap-1.5 rounded-[5px] bg-deny px-2 text-[12px] font-medium text-deny-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <OctagonPause className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">{t(me.kill_switch === 'all' ? 'banner.kill.short.all' : 'banner.kill.short.writes')}</span>
    </NavLink>
  );
}

/** Initials button with a small menu: name, roles (mono), sign out. */
function UserMenu() {
  const me = useMe();
  const { logout } = useSession();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="user-menu"
        aria-label={`${t('user.open')}: ${me.name}`}
        title={t('user.menu', { name: me.name })}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-7 items-center justify-center rounded-full border bg-muted text-[11px] font-medium hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initials(me.name)}
      </button>
      {open && (
        <div id="user-menu" className="absolute right-0 top-9 z-50 w-56 animate-fade-in rounded-md border bg-popover p-1 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.5)]">
          <div className="px-2.5 py-2">
            <p className="truncate text-[13px] font-medium">{me.name}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{me.roles.join(' · ')}</p>
          </div>
          <div className="my-1 border-t" />
          <button
            type="button"
            onClick={() => void logout()}
            className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2.5 text-[13px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            {t('user.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const me = useMe();
  const { info } = useSession();
  const { toDecide } = useLive();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  const items: NavItem[] = [
    { to: '/', label: 'nav.chat', end: true },
    { to: '/approvals', label: 'nav.approvals', badge: toDecide },
    { to: '/memory', label: 'nav.memory' },
    { to: '/costs', label: 'nav.costs' },
  ];
  if (me.admin) items.push({ to: '/console', label: 'nav.console' });

  const nav = (mobile: boolean) => (
    <ul className={cn(mobile ? 'flex flex-col p-1' : 'flex h-11 items-stretch gap-4')}>
      {items.map(({ to, label, end, badge }) => (
        <li key={to} className="flex">
          <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'relative inline-flex w-full items-center gap-1.5 text-[13px] transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                mobile ? 'h-9 rounded-[4px] px-2.5' : 'h-full',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                isActive && !mobile && 'after:absolute after:inset-x-0 after:bottom-[-1px] after:h-px after:bg-foreground',
                isActive && mobile && 'bg-accent',
              )
            }
          >
            {t(label)}
            {badge ? (
              <span
                className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-approval px-1 font-mono text-[10px] font-semibold tabular-nums text-approval-ink"
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
        className="sr-only z-50 rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-2"
      >
        {t('app.skip')}
      </a>
      <header className="shrink-0 border-b bg-background">
        <div className="flex h-11 items-center gap-6 px-4">
          <NavLink to="/" className="flex shrink-0 items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark size={20} metal="bar" />
            <span className="text-[13px] font-semibold tracking-[-0.01em]">{t('app.name')}</span>
            <span className="hidden text-[12px] text-muted-foreground sm:inline">{info?.company ?? me.company}</span>
          </NavLink>
          <nav aria-label={t('nav.main')} className="hidden md:block">
            {nav(false)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <KillIndicator />
            <TestAsIndicator />
            <ThemeToggle />
            <UserMenu />
            <Button
              variant="ghost"
              size="icon-sm"
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
