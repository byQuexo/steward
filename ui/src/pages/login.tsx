import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { UserAvatar } from '@/components/avatars';
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
    <div className="relative min-h-dvh bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent"
      />
      <header className="container relative flex h-14 items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="text-sm font-semibold">{t('app.name')}</span>
        </div>
        <ThemeToggle />
      </header>
      <main id="main" className="container relative max-w-3xl pb-16 pt-8">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden>
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 className="text-3xl font-semibold tracking-tight">
            {info?.assistant ?? t('app.name')}
            {info?.company ? <span className="block text-base font-normal text-muted-foreground">{info.company}</span> : null}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{t('login.subtitle')}</p>
        </div>

        {error && (
          <Alert variant="error" className="mb-4" role="alert">
            {error}
          </Alert>
        )}

        {info?.login === 'oidc' ? (
          <div className="mx-auto max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm">
            <h2 className="text-lg font-semibold">{t('login.title')}</h2>
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
            <h2 id="login-title" className="text-lg font-semibold">
              {t('login.title')}
            </h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">{t('login.devHint')}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {(info?.dev_users ?? []).map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => void login(u.id)}
                    disabled={!!busy}
                    data-testid={`login-${u.id}`}
                    title={t('login.as', { name: u.name })}
                    className="group flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    <UserAvatar name={u.name} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{u.name}</span>
                        {u.roles.includes('it-admin') && <Badge variant="info">{t('login.admin')}</Badge>}
                      </span>
                      {u.title && <span className="block truncate text-sm text-muted-foreground">{u.title}</span>}
                      <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{u.roles.join(' · ')}</span>
                    </span>
                    <ArrowRight
                      className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="mt-10 text-center text-xs text-muted-foreground">{t('login.footer')}</p>
      </main>
    </div>
  );
}
