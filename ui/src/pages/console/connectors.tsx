import { Activity, AlertOctagon, CircleHelp, Plug, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/context/i18n';
import { api } from '@/lib/api';
import type { Connector } from '@/lib/types';
import { errorMessage } from '@/lib/utils';

function Health({ c }: { c: Connector }) {
  const { t } = useI18n();
  const state = c.health?.state ?? 'unknown';
  const failures = c.health?.consecutive_failures ?? 0;
  const variant = state === 'closed' ? 'allow' : state === 'open' ? 'deny' : state === 'half_open' ? 'approval' : 'muted';
  const Icon = state === 'closed' ? Activity : state === 'open' ? AlertOctagon : CircleHelp;
  const key = (['closed', 'open', 'half_open'].includes(state) ? `conn.health.${state}` : 'conn.health.unknown') as
    | 'conn.health.closed'
    | 'conn.health.open'
    | 'conn.health.half_open'
    | 'conn.health.unknown';
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant={variant} data-testid="connector-health">
        <Icon aria-hidden />
        {t(key)}
      </Badge>
      {failures > 0 && <span className="text-xs text-muted-foreground">{t('conn.failures', { count: failures })}</span>}
    </span>
  );
}

export function ConnectorsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<Connector[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.connectors().then(
      (r) => {
        setData(r.connectors);
        setError(null);
      },
      (e) => setError(errorMessage(e)),
    );
  }, []);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="conn-title">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 id="conn-title" className="text-lg font-semibold">
            {t('conn.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('conn.subtitle')}</p>
        </div>
        <Button variant="outline" size="icon" onClick={load} aria-label={t('approvals.refresh')} title={t('approvals.refresh')}>
          <RefreshCw aria-hidden />
        </Button>
      </div>
      {error && <Alert variant="error">{t('common.error', { error })}</Alert>}
      {!data ? (
        !error && <Skeleton className="h-64" />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('conn.empty')}</p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {data.map((c) => (
            <li key={c.name}>
              <Card className="h-full" data-testid="connector-card">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle as="h3" className="flex items-center gap-2">
                        <Plug className="h-4 w-4 text-muted-foreground" aria-hidden />
                        {c.title}
                        <code className="font-mono text-xs font-normal text-muted-foreground">{c.name}</code>
                      </CardTitle>
                      <CardDescription className="mt-1">{c.description}</CardDescription>
                    </div>
                    <Health c={c} />
                  </div>
                </CardHeader>
                <CardContent className="px-2 pb-2">
                  <Table label={`${c.title}: ${t('conn.tool')}`}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('conn.tool')}</TableHead>
                        <TableHead>{t('conn.scopes')}</TableHead>
                        <TableHead>{t('conn.sensitivity')}</TableHead>
                        <TableHead>{t('conn.tags')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {c.tools.map((tool) => (
                        <TableRow key={tool.name}>
                          <TableCell className="font-mono text-xs">{tool.name}</TableCell>
                          <TableCell className="font-mono text-xs">{tool.scopes.join(', ')}</TableCell>
                          <TableCell>
                            <Badge variant={tool.sensitivity === 'write' ? 'approval' : 'muted'}>
                              {tool.sensitivity === 'write' ? t('conn.sens.write') : t('conn.sens.read')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{tool.tags.join(', ')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
