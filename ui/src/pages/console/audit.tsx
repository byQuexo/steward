import { RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { DecisionBadge } from '@/components/decision';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/context/i18n';
import { api } from '@/lib/api';
import type { Audit, AuditEvent } from '@/lib/types';
import { errorMessage } from '@/lib/utils';

function actionOf(e: AuditEvent): string {
  if (e.action?.name) return e.action.kind && e.action.kind !== 'tool' ? `${e.action.kind}:${e.action.name}` : e.action.name;
  return '';
}

export function AuditPage() {
  const { t } = useI18n();
  const filterId = useId();
  const [data, setData] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.audit(200));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const events = useMemo(() => {
    const all = [...(data?.events ?? [])].reverse();
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((e) => [e.subject, e.agent, actionOf(e), e.rule, e.event, e.effect].some((x) => x?.toLowerCase().includes(q)));
  }, [data, filter]);

  const v = data?.verify;
  const verify =
    v?.status === 'ok' ? (
      <Badge variant="outline">
        <ShieldCheck aria-hidden />
        {t('audit.verify.ok', { chains: String(v.chains ?? 0) })}
      </Badge>
    ) : v?.status === 'failed' ? (
      <Badge variant="default">
        <ShieldAlert aria-hidden />
        {t('audit.verify.failed', { error: String(v.error ?? '') })}
      </Badge>
    ) : v ? (
      <Badge variant="muted">
        <ShieldQuestion aria-hidden />
        {t('audit.verify.notConfigured')}
      </Badge>
    ) : null;

  return (
    <section aria-labelledby="audit-title">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="audit-title" className="text-[20px] font-medium tracking-[-0.02em]">
            {t('audit.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('audit.subtitle')}</p>
          <p className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('audit.verify')}:</span> {verify}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={filterId} className="text-xs">
              {t('audit.filter')}
            </Label>
            <Input id={filterId} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('audit.filterPlaceholder')} className="w-56" />
          </div>
          <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading} aria-label={t('approvals.refresh')} title={t('approvals.refresh')}>
            <RefreshCw className={loading ? 'motion-safe:animate-spin' : undefined} aria-hidden />
          </Button>
        </div>
      </div>
      {error && <Alert variant="error">{t('common.error', { error })}</Alert>}
      {!data && !error ? (
        <Skeleton className="h-64" />
      ) : data ? (
        <Card>
          <CardContent className="p-2">
            <p className="px-3 py-1 text-xs text-muted-foreground" aria-live="polite">
              {t('audit.count', { count: events.length })}
            </p>
            {events.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{t('audit.empty')}</p>
            ) : (
              <Table label={t('audit.title')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('audit.event')}</TableHead>
                    <TableHead>{t('audit.subject')}</TableHead>
                    <TableHead>{t('audit.agent')}</TableHead>
                    <TableHead>{t('audit.action')}</TableHead>
                    <TableHead>{t('audit.effect')}</TableHead>
                    <TableHead>{t('audit.reason')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{e.event ?? t('common.none')}</TableCell>
                      <TableCell>{e.subject ?? t('common.none')}</TableCell>
                      <TableCell className="font-mono text-xs">{[...(e.act ?? []), e.agent].filter(Boolean).join(' → ')}</TableCell>
                      <TableCell className="font-mono text-xs">{actionOf(e) || t('common.none')}</TableCell>
                      <TableCell>
                        {e.effect ? (
                          <DecisionBadge effect={e.effect} rule={e.rule} />
                        ) : e.rule ? (
                          <code className="font-mono text-[11px] text-muted-foreground">{e.rule}</code>
                        ) : (
                          t('common.none')
                        )}
                      </TableCell>
                      <TableCell className="max-w-[20rem] text-xs text-muted-foreground">{e.reason ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
