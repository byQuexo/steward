import { RefreshCw, ServerCrash } from 'lucide-react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/components/app-shell';
import { Orb } from '@/components/avatars';
import { Button } from '@/components/ui/button';
import { ChatProvider } from '@/context/chat';
import { I18nProvider, useI18n } from '@/context/i18n';
import { LiveProvider } from '@/context/live';
import { SessionProvider, useSession } from '@/context/session';
import { ToastProvider } from '@/context/toast';
import { pickLocale } from '@/i18n';
import { ApprovalsPage } from '@/pages/approvals';
import { ChatPage } from '@/pages/chat';
import { AuditPage } from '@/pages/console/audit';
import { ConnectorsPage } from '@/pages/console/connectors';
import { EffectivePage } from '@/pages/console/effective';
import { KillPage } from '@/pages/console/kill';
import { ConsoleLayout } from '@/pages/console/layout';
import { TestAsPage } from '@/pages/console/test-as';
import { UsersPage } from '@/pages/console/users';
import { CostsPage } from '@/pages/costs';
import { LoginPage } from '@/pages/login';
import { MemoryPage } from '@/pages/memory';

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="container max-w-xl py-24">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 text-[32px] font-medium tracking-[-0.03em]">{t('notFound.title')}</h1>
      <Link to="/" className="mt-6 inline-block text-[12.5px] text-foreground underline decoration-foreground/40 underline-offset-4 hover:decoration-foreground">
        {t('notFound.back')}
      </Link>
    </div>
  );
}

function Splash() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4" aria-busy="true">
      <Orb state="working" size={32} />
      <p className="font-mono text-[12px] text-muted-foreground">{t('app.loading')}</p>
    </main>
  );
}

function Offline({ error }: { error: string | null }) {
  const { t } = useI18n();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <ServerCrash className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-medium tracking-[-0.02em]">{t('app.backendDown')}</h1>
      {error && <p className="font-mono text-xs text-muted-foreground">{error}</p>}
      <Button onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden />
        {t('app.retry')}
      </Button>
    </main>
  );
}

function Routed() {
  const { status, error } = useSession();
  if (status === 'loading') return <Splash />;
  if (status === 'offline') return <Offline error={error} />;
  if (status === 'anonymous') return <LoginPage />;
  return (
    <LiveProvider>
      <ChatProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<ChatPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="memory" element={<MemoryPage />} />
            <Route path="costs" element={<CostsPage />} />
            <Route path="console" element={<ConsoleLayout />}>
              <Route index element={<Navigate to="effective" replace />} />
              <Route path="effective" element={<EffectivePage />} />
              <Route path="test-as" element={<TestAsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="kill" element={<KillPage />} />
              <Route path="connectors" element={<ConnectorsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ChatProvider>
    </LiveProvider>
  );
}

function Localized() {
  const { info } = useSession();
  return (
    <I18nProvider locale={pickLocale(info?.locale ?? navigator.language)}>
      <ToastProvider>
        <Routed />
      </ToastProvider>
    </I18nProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Localized />
      </SessionProvider>
    </BrowserRouter>
  );
}
