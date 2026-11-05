import { FlaskConical, Play } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { UserAvatar } from '@/components/avatars';
import { DecisionBadge } from '@/components/decision';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/context/i18n';
import { api, ApiError } from '@/lib/api';
import { exampleArgs, parseCatalog, type CatalogEntry } from '@/lib/catalog';
import type { AdminUsers, Effective, PolicyInfo, WhatIfResult } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';

function Chips({ items, mono = true }: { items: string[]; mono?: boolean }) {
  const { t } = useI18n();
  if (items.length === 0) return <span className="text-sm text-muted-foreground">{t('eff.none')}</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <li key={s}>
          <Badge variant="secondary" className={cn(mono && 'font-mono text-[11px]')}>
            {s}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function outcomeTone(outcome: string): string {
  const o = outcome.toLowerCase();
  if (['deny', 'denied', 'fail', 'missing', 'blocked'].some((x) => o.includes(x))) return 'text-deny-foreground';
  if (['approval', 'require_approval'].some((x) => o.includes(x))) return 'text-approval-foreground';
  if (['ok', 'pass', 'allow', 'granted'].some((x) => o.includes(x))) return 'text-allow-foreground';
  return 'text-muted-foreground';
}

function WhatIf({ eff, policy }: { eff: Effective; policy: PolicyInfo | null }) {
  const { t } = useI18n();
  const ids = { action: useId(), agent: useId(), args: useId() };
  const catalog = useMemo(() => (policy ? parseCatalog(policy.catalog) : []), [policy]);
  const kinds = useMemo(() => Array.from(new Set(catalog.map((c) => c.kind))), [catalog]);
  const [action, setAction] = useState('');
  const [agent, setAgent] = useState(eff.principal.agent);
  const [args, setArgs] = useState('{}');
  const [argsError, setArgsError] = useState<string | null>(null);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const entry: CatalogEntry | undefined = catalog.find((c) => `${c.kind}:${c.name}` === action);

  useEffect(() => {
    if (!action && catalog[0]) setAction(`${catalog[0].kind}:${catalog[0].name}`);
  }, [action, catalog]);

  useEffect(() => {
    setArgs(JSON.stringify(exampleArgs(entry, eff.user.attrs), null, 2));
    setResult(null);
    // Only when the action or the person changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, eff.user.id]);

  useEffect(() => {
    setAgent(eff.principal.agent);
    setResult(null);
  }, [eff.principal.agent, eff.user.id]);

  const run = async () => {
    if (!entry) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(args || '{}');
      setArgsError(null);
    } catch (e) {
      setArgsError(t('whatif.argsInvalid', { error: errorMessage(e) }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const principal = { ...eff.principal, agent };
      setResult(await api.whatIf(principal, { kind: entry.kind, name: entry.name, args: parsed }));
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError && (e.status === 404 || e.status === 405) ? t('whatif.missing') : t('whatif.failed', { error: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3" className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t('whatif.title')}
        </CardTitle>
        <CardDescription>{t('whatif.subtitle', { name: eff.user.name })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!policy ? (
          <Skeleton className="h-24" />
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor={ids.action}>{t('whatif.action')}</Label>
                <Select id={ids.action} value={action} onChange={(e) => setAction(e.target.value)} data-testid="whatif-action">
                  {kinds.map((k) => (
                    <optgroup key={k} label={k}>
                      {catalog
                        .filter((c) => c.kind === k)
                        .map((c) => (
                          <option key={`${c.kind}:${c.name}`} value={`${c.kind}:${c.name}`}>
                            {c.name}
                            {c.sensitivity === 'write' ? ' ✎' : ''}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={ids.agent}>{t('whatif.agent')}</Label>
                <Select id={ids.agent} value={agent} onChange={(e) => setAgent(e.target.value)}>
                  {Object.entries(policy.agents).map(([role, id]) => (
                    <option key={id} value={id}>
                      {id} ({role})
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {entry && (
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {t('eff.scopes')}: <Chips items={entry.scopes} />
                {entry.tags.length > 0 && <Chips items={entry.tags} />}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={ids.args}>{t('whatif.args')}</Label>
              <Textarea
                id={ids.args}
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                rows={5}
                spellCheck={false}
                className="font-mono text-xs"
                aria-invalid={!!argsError}
                aria-describedby={argsError ? `${ids.args}-err` : undefined}
                data-testid="whatif-args"
              />
              {argsError && (
                <p id={`${ids.args}-err`} className="text-xs text-deny-foreground">
                  {argsError}
                </p>
              )}
            </div>
            <Button type="submit" disabled={busy || !entry} data-testid="whatif-run">
              <Play aria-hidden />
              {t('whatif.run')}
            </Button>
          </form>
        )}

        {error && <Alert variant="error">{error}</Alert>}

        {result && (
          <section aria-label={t('whatif.result')} className="space-y-3 rounded-lg border bg-muted/30 p-4" data-testid="whatif-result">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t('whatif.result')}:</span>
              <DecisionBadge effect={result.effect} rule={result.rule} />
            </div>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted-foreground">{t('whatif.reason')}</dt>
              <dd>{result.reason}</dd>
              <dt className="text-muted-foreground">{t('whatif.modelMessage')}</dt>
              <dd className="italic">{result.model_message}</dd>
            </dl>
            <div>
              <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('whatif.trace')}</h4>
              <Table label={t('whatif.trace')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>{t('whatif.step')}</TableHead>
                    <TableHead>{t('whatif.outcome')}</TableHead>
                    <TableHead>{t('whatif.detail')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.trace.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{s.step}</TableCell>
                      <TableCell className={cn('font-mono text-xs font-medium', outcomeTone(s.outcome))}>{s.outcome}</TableCell>
                      <TableCell className="text-xs">{s.detail}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

export function EffectivePage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const selected = params.get('user');
  const [users, setUsers] = useState<AdminUsers | null>(null);
  const [eff, setEff] = useState<Effective | null>(null);
  const [policy, setPolicy] = useState<PolicyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminUsers().then(setUsers, (e) => setError(errorMessage(e)));
    api.policy().then(setPolicy, () => {});
  }, []);

  useEffect(() => {
    if (!selected) {
      setEff(null);
      return;
    }
    let cancelled = false;
    api.effective(selected).then(
      (e) => !cancelled && setEff(e),
      (e) => !cancelled && setError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (error) return <Alert variant="error">{t('common.error', { error })}</Alert>;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>{t('eff.users')}</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          {!users ? (
            <Skeleton className="h-64" />
          ) : (
            <Table label={t('eff.users')} data-testid="users-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('eff.name')}</TableHead>
                  <TableHead>{t('eff.roles')}</TableHead>
                  <TableHead className="text-right">{t('eff.scopes')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.users.map(({ user, effective_scopes, title }) => {
                  const active = user.id === selected;
                  return (
                    <TableRow key={user.id} data-state={active ? 'selected' : undefined}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setParams({ user: user.id })}
                          aria-pressed={active}
                          className="flex items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <UserAvatar name={user.name} size={26} />
                          <span>
                            <span className="block font-medium">{user.name}</span>
                            <span className="block text-xs text-muted-foreground">{title ?? user.id}</span>
                          </span>
                          <span className="sr-only">{t('eff.select', { name: user.name })}</span>
                        </button>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{user.roles.join(', ')}</TableCell>
                      <TableCell className="text-right tabular-nums">{effective_scopes.length}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="space-y-6">
        {!selected ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t('eff.pick')}</p>
        ) : !eff ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <Card data-testid="effective-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserAvatar name={eff.user.name} size={28} />
                  {eff.user.name}
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  {t('console.policyVersion')}: {eff.policy_version.slice(0, 19)}…
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('eff.scopesCount', { count: eff.effective_scopes.length })}</h3>
                  <Chips items={eff.effective_scopes} />
                </div>
                <div>
                  <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('eff.tools')}</h3>
                  <Chips items={eff.tools} />
                </div>
                <div>
                  <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('eff.attrs')}</h3>
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                    {Object.entries(eff.user.attrs).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="break-words">{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </CardContent>
            </Card>
            <WhatIf eff={eff} policy={policy} />
          </>
        )}
      </div>
    </div>
  );
}
