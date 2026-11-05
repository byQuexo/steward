import { Brain, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, EmptyNote, PageHeader, Skeleton } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import { useToast } from '@/context/toast';
import { api } from '@/lib/api';
import type { MemoryList } from '@/lib/types';
import { errorMessage, formatDate } from '@/lib/utils';

export function MemoryPage() {
  const { t, intl } = useI18n();
  const { toast } = useToast();
  const [data, setData] = useState<MemoryList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.memory());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const forget = async (id: number) => {
    try {
      await api.forget(id);
      toast(t('memory.deleted'), { variant: 'success' });
    } catch (e) {
      toast(t('common.error', { error: errorMessage(e) }), { variant: 'error' });
    }
    await load();
  };

  const forgetAll = async () => {
    try {
      await api.forgetAll();
      toast(t('memory.deleted'), { variant: 'success' });
    } catch (e) {
      toast(t('common.error', { error: errorMessage(e) }), { variant: 'error' });
    }
    await load();
  };

  const facts = data?.facts ?? [];

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-12 sm:px-6">
      <PageHeader
        title={t('memory.title')}
        description={t('memory.subtitle')}
        actions={
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={facts.length === 0}>
                <Trash2 aria-hidden />
                {t('memory.deleteAll')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('memory.deleteAllTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('memory.deleteAllBody', { count: facts.length })}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction destructive onClick={() => void forgetAll()}>
                  {t('memory.deleteAll')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />
      {data && <p className="-mt-4 mb-6 font-mono text-[11.5px] text-muted-foreground">{t('memory.retention', { days: data.retention_days })}</p>}
      {error ? (
        <Alert variant="denied">{t('memory.forbidden', { error })}</Alert>
      ) : !data ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : facts.length === 0 ? (
        <EmptyNote icon={Brain}>{t('memory.empty')}</EmptyNote>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {facts.map((f) => (
            <li key={f.id} className="flex items-center gap-4 px-5 py-4">
              <Brain className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="break-words text-[15px]">{f.text}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
                  {t('memory.created', { date: formatDate(f.created_at, intl) })}
                  {f.team && <Badge variant="muted">{t('memory.team', { team: f.team })}</Badge>}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void forget(f.id)} aria-label={t('memory.deleteItem', { text: f.text })}>
                <Trash2 aria-hidden />
                <span className="hidden sm:inline">{t('memory.delete')}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
