import { OctagonPause, PauseCircle, PlayCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Alert, Skeleton } from '@/components/ui/misc';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useI18n } from '@/context/i18n';
import { useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import { api } from '@/lib/api';
import type { KillMode } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';

const modes: { mode: KillMode; icon: typeof PlayCircle; tone: string }[] = [
  { mode: 'off', icon: PlayCircle, tone: 'data-[state=checked]:border-allow data-[state=checked]:bg-allow-soft' },
  { mode: 'writes', icon: PauseCircle, tone: 'data-[state=checked]:border-approval data-[state=checked]:bg-approval-soft' },
  { mode: 'all', icon: OctagonPause, tone: 'data-[state=checked]:border-deny data-[state=checked]:bg-deny-soft' },
];

export function KillPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { refresh } = useSession();
  const [mode, setMode] = useState<KillMode | null>(null);
  const [pending, setPending] = useState<KillMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.kill().then(
      (k) => setMode(k.mode),
      (e) => setError(errorMessage(e)),
    );
  }, []);

  const label = (m: KillMode) => t(`kill.${m}`);

  const apply = async () => {
    if (!pending) return;
    const target = pending;
    setPending(null);
    try {
      const r = await api.setKill(target);
      setMode(r.mode ?? target);
      toast(t('kill.saved', { mode: label(r.mode ?? target) }), { variant: target === 'off' ? 'success' : 'info' });
      await refresh();
    } catch (e) {
      toast(t('kill.failed', { error: errorMessage(e) }), { variant: 'error' });
    }
  };

  return (
    <section aria-labelledby="kill-title" className="max-w-3xl">
      <h2 id="kill-title" className="text-[20px] font-medium tracking-[-0.02em]">
        {t('kill.title')}
      </h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">{t('kill.subtitle')}</p>
      {error && <Alert variant="error">{t('common.error', { error })}</Alert>}
      {!mode ? (
        !error && <Skeleton className="h-48" />
      ) : (
        <>
          <p className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('kill.current')}:</span>
            <Badge variant={mode === 'off' ? 'allow' : mode === 'writes' ? 'approval' : 'deny'} data-testid="kill-mode">
              {label(mode)}
            </Badge>
          </p>
          <RadioGroup value={mode} onValueChange={(v) => v !== mode && setPending(v as KillMode)} aria-label={t('kill.options')} className="gap-3">
            {modes.map(({ mode: m, icon: Icon, tone }) => (
              <label
                key={m}
                htmlFor={`kill-${m}`}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40',
                  mode === m && (m === 'off' ? 'border-allow bg-allow-soft' : m === 'writes' ? 'border-approval bg-approval-soft' : 'border-deny bg-deny-soft'),
                )}
              >
                <RadioGroupItem id={`kill-${m}`} value={m} className={cn('mt-1', tone)} />
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  <span className="block font-medium">{label(m)}</span>
                  <span className="block text-sm text-muted-foreground">{t(`kill.${m}Hint` as const)}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </>
      )}
      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('kill.confirmTitle', { mode: pending ? label(pending) : '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('kill.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('kill.cancel')}</AlertDialogCancel>
            <AlertDialogAction destructive={pending !== 'off'} onClick={() => void apply()}>
              {t('kill.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
