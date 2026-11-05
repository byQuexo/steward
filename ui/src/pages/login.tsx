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
      <header className="relative flex h-14 items-center justify-between px-5">
        <div className="flex items-center gap-2.5">
          <BrandMark size={28} />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">{t('app.name')}</span>
        </div>
        <ThemeToggle />
      </header>
      <main id="main" className="relative mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:pt-20">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <BrandMark size={72} metal="hero" />
          <p className="eyebrow mt-10">{info?.company ?? t('app.name')}</p>
          <h1 className="mt-3 text-[44px] font-medium leading-[1.02] tracking-[-0.04em] sm:text-[56px]">{info?.assistant ?? t('app.name')}</h1>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted-foreground">{t('login.subtitle')}</p>
          <ul className="mt-8 space-y-2.5 font-mono text-[12px] text-muted-foreground" aria-label={t('legend.title')}>
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
            <div className="max-w-sm rounded-lg border bg-card p-6">
              <h2 className="text-lg font-medium tracking-[-0.015em]">{t('login.title')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('login.oidcHint')}</p>
              <Button asChild size="lg" className="mt-5 w-full">
                <a href="/auth/login">
                  <KeyRound aria-hidden />
                  {t('login.oidc')}
                </a>
              </Button>
            </div>
          ) : (
            <section aria-labelledby="login-title">
              <div className="mb-5 border-b pb-5">
                <h2 id="login-title" className="eyebrow">
                  {t('login.title')}
                </h2>
                <p className="mt-2 text-[15px] text-muted-foreground">{t('login.devHint')}</p>
              </div>
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {(info?.dev_users ?? []).map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => void login(u.id)}
                      disabled={!!busy}
                      data-testid={`login-${u.id}`}
                      title={t('login.as', { name: u.name })}
                      className="group flex w-full items-center gap-3.5 rounded-lg border bg-card px-4 py-3.5 text-left transition-colors duration-micro hover:border-foreground/30 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                      <UserAvatar name={u.name} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-medium">{u.name}</span>
                          {u.roles.includes('it-admin') && <Badge variant="info">{t('login.admin')}</Badge>}
                        </span>
                        {u.title && <span className="block truncate text-[13px] text-muted-foreground">{u.title}</span>}
                        <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{u.roles.join(' · ')}</span>
                      </span>
                      <ArrowRight
                        className="h-4 w-4 text-subtle transition-transform duration-micro group-hover:translate-x-0.5 group-hover:text-foreground"
                        aria-hidden
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="mt-8 font-mono text-[11px] text-muted-foreground">{t('login.footer')}</p>
        </div>
      </main>
    </div>
  );
}
