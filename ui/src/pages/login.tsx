import { ArrowRight, KeyRound } from 'lucide-react';
import { useState } from 'react';

import { BrandMark, UserAvatar } from '@/components/avatars';
import { VerdictDot } from '@/components/decision';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import { useSession } from '@/context/session';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';

export function LoginPage() {
  const { info, refresh } = useSession();
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const login = async (user: string) => {
    setBusy(user);
    setError(null);
    try {
      await api.devLogin(user);
      await refresh();
    } catch (e) {
      setError(t('login.failed', { error: errorMessage(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div aria-hidden className="hero-grid pointer-events-none absolute inset-0" />
      <header className="relative flex h-11 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <BrandMark size={20} />
          <span className="text-[13px] font-semibold tracking-[-0.01em]">{t('app.name')}</span>
        </div>
        <ThemeToggle />
      </header>
      <main id="main" className="relative mx-auto grid max-w-[1040px] gap-10 px-4 pb-12 pt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14 lg:pt-16">
        <div className="lg:sticky lg:top-16 lg:self-start">
          <BrandMark size={44} metal="hero" />
          <p className="eyebrow mt-6">{info?.company ?? t('app.name')}</p>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.03em]">{info?.assistant ?? t('app.name')}</h1>
          <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-muted-foreground">{t('login.subtitle')}</p>
          <ul className="mt-6 space-y-1.5 font-mono text-[11.5px] text-muted-foreground" aria-label={t('legend.title')}>
            <li className="text-foreground">{t('legend.title')}</li>
            <li className="flex items-center gap-2.5">
              <VerdictDot tone="allow" />
              {t('legend.allow')}
            </li>
            <li className="flex items-center gap-2.5">
              <VerdictDot tone="approval" />
              {t('legend.approval')}
            </li>
            <li className="flex items-center gap-2.5">
              <VerdictDot tone="deny" />
              {t('legend.deny')}
            </li>
          </ul>
        </div>

        <div>
          {error && (
            <Alert variant="error" className="mb-4" role="alert">
              {error}
            </Alert>
          )}

          {info?.login === 'oidc' ? (
            <div className="max-w-sm rounded-lg border bg-card p-4">
              <h2 className="text-[15px] font-semibold">{t('login.title')}</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">{t('login.oidcHint')}</p>
              <Button asChild className="mt-4 w-full">
                <a href="/auth/login">
                  <KeyRound aria-hidden />
                  {t('login.oidc')}
                </a>
              </Button>
            </div>
          ) : (
            <section aria-labelledby="login-title">
              <div className="mb-3">
                <h2 id="login-title" className="eyebrow">
                  {t('login.title')}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">{t('login.devHint')}</p>
              </div>
              <ul className="overflow-hidden rounded-md border">
                {(info?.dev_users ?? []).map((u) => (
                  <li key={u.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => void login(u.id)}
                      disabled={!!busy}
                      data-testid={`login-${u.id}`}
                      title={t('login.as', { name: u.name })}
                      className="group flex w-full items-center gap-3 bg-card px-3 py-2 text-left transition-colors duration-micro hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
                    >
                      <UserAvatar name={u.name} size={28} />
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="truncate text-[13.5px] font-medium">{u.name}</span>
                        {u.title && <span className="hidden truncate text-[12.5px] text-muted-foreground sm:inline">{u.title}</span>}
                        {u.roles.includes('it-admin') && <Badge variant="info">{t('login.admin')}</Badge>}
                      </span>
                      <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">{u.roles.join(' · ')}</span>
                      <ArrowRight
                        className="h-3.5 w-3.5 text-subtle transition-transform duration-micro group-hover:translate-x-0.5 group-hover:text-foreground"
                        aria-hidden
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">{t('login.footer')}</p>
        </div>
      </main>
    </div>
  );
}
