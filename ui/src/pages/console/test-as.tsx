import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { UserAvatar } from '@/components/avatars';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import { useMe, useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import { api } from '@/lib/api';
import type { AdminUsers } from '@/lib/types';
import { errorMessage } from '@/lib/utils';

export function TestAsPage() {
  const me = useMe();
  const { refresh } = useSession();
  const { t } = useI18n();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUsers | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminUsers().then(setUsers, (e) => setError(errorMessage(e)));
  }, []);

  const start = async (id: string, name: string) => {
    setBusy(id);
    try {
      await api.testAs(id);
      await refresh();
      toast(t('testAs.started', { name }), { variant: 'success' });
      navigate('/');
    } catch (e) {
      toast(t('testAs.failed', { error: errorMessage(e) }), { variant: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="test-as-title">
      <h2 id="test-as-title" className="text-lg font-semibold">
        {t('testAs.title')}
      </h2>
      <p className="mb-5 mt-1 max-w-2xl text-sm text-muted-foreground">{t('testAs.subtitle')}</p>
      {error && <Alert variant="error">{t('common.error', { error })}</Alert>}
      {!users ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {users.users.map(({ user, title }) => {
            const self = user.id === me.user;
            return (
              <li key={user.id} className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-sm">
                <UserAvatar name={user.name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{title ?? user.roles.join(', ')}</p>
                </div>
                {self ? (
                  <span className="text-xs text-muted-foreground">{t('testAs.self')}</span>
                ) : (
                  <Button size="sm" variant="outline" disabled={!!busy || !user.enabled} onClick={() => void start(user.id, user.name)}>
                    <Eye aria-hidden />
                    <span className="sr-only">{t('testAs.start', { name: user.name })}</span>
                    <span aria-hidden>{t('testAs.button')}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
