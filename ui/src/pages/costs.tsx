import { Coins, Gauge, Hash, Layers } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Alert, PageHeader, Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/context/i18n';
import { useMe } from '@/context/session';
import { api } from '@/lib/api';
import type { Costs, Totals } from '@/lib/types';
import { cn, errorMessage, formatDateTime, formatEur, formatNumber } from '@/lib/utils';

type AllCosts = Extract<Costs, { scope: 'all' }>;

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone = pct >= 90 ? 'bg-deny' : pct >= 70 ? 'bg-approval' : 'bg-allow';
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className={cn('h-full rounded-full transition-[width]', tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Coins; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </p>
        <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/** One breakdown (single series): a labeled bar list. Values are text, so it doubles as a table. */
function Breakdown({ title, rows, currency }: { title: string; rows: Totals[]; currency: string }) {
  const { t, intl } = useI18n();
  const max = Math.max(...rows.map((r) => r.eur), 0);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle as="h3">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('costs.empty')}</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.slice(0, 8).map((r) => (
              <li key={r.key} title={`${formatNumber(r.calls, intl)} ${t('costs.calls')} · ${formatNumber(r.input_tokens + r.output_tokens, intl)} ${t('costs.tokens')}`}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{r.key}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatEur(r.eur, intl, currency)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-chart-1" style={{ width: `${max > 0 ? Math.max(2, (r.eur / max) * 100) : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ByDay({ data }: { data: AllCosts }) {
  const { t, intl } = useI18n();
  const rows = [...data.by_day].sort((a, b) => a.key.localeCompare(b.key));
  const fmtDay = (k: string) => new Intl.DateTimeFormat(intl, { day: '2-digit', month: '2-digit' }).format(new Date(`${k}T00:00:00`));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle as="h3">{t('costs.byDay')}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('costs.empty')}</p>
        ) : (
          <figure>
            <div className="h-56 w-full" role="img" aria-label={t('costs.chartLabel', { title: t('costs.byDay') })}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={6}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
                  <XAxis dataKey="key" tickFormatter={fmtDay} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <YAxis
                    tickFormatter={(v: number) => formatEur(v, intl, data.currency)}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))' }}
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      color: 'hsl(var(--popover-foreground))',
                      fontSize: 12,
                    }}
                    labelFormatter={(k: string) => fmtDay(k)}
                    formatter={(v: number, _n, p) => [
                      `${formatEur(v, intl, data.currency)} · ${formatNumber((p.payload as Totals).calls, intl)} ${t('costs.calls')}`,
                      t('costs.total'),
                    ]}
                  />
                  <Bar dataKey="eur" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <figcaption className="sr-only">
              {rows.map((r) => `${fmtDay(r.key)}: ${formatEur(r.eur, intl, data.currency)}`).join('; ')}
            </figcaption>
          </figure>
        )}
      </CardContent>
    </Card>
  );
}

function Budgets({ data }: { data: AllCosts }) {
  const { t, intl } = useI18n();
  const b = data.budgets;
  const teamSpend = new Map(data.by_team.map((r) => [r.key, r.eur]));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle as="h3">{t('costs.budgets')}</CardTitle>
        <CardDescription>
          {b.per_run != null && <>{t('costs.perRun')}: {formatEur(b.per_run, intl, data.currency)}</>}
          {b.per_user_daily != null && <> · {t('costs.perUserDaily')}: {formatEur(b.per_user_daily, intl, data.currency)}</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {Object.entries(b.team_monthly ?? {}).map(([team, budget]) => {
            const spent = teamSpend.get(team) ?? 0;
            const label = t('costs.teamMonthly', { team });
            return (
              <li key={team}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {t('costs.ofBudget', { used: formatEur(spent, intl, data.currency), budget: formatEur(budget, intl, data.currency) })}
                  </span>
                </div>
                <Meter value={spent} max={budget} label={label} />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function AllView({ data, days }: { data: AllCosts; days: number }) {
  const { t, intl } = useI18n();
  const calls = data.by_day.reduce((s, r) => s + r.calls, 0);
  const inTok = data.by_day.reduce((s, r) => s + r.input_tokens, 0);
  const outTok = data.by_day.reduce((s, r) => s + r.output_tokens, 0);
  return (
    <div className="space-y-6">
      <section aria-label={t('costs.total')} className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Coins} label={t('costs.total')} value={formatEur(data.total_eur, intl, data.currency)} sub={t('costs.days', { days })} />
        <Stat icon={Hash} label={t('costs.calls')} value={formatNumber(calls, intl)} />
        <Stat
          icon={Layers}
          label={t('costs.tokens')}
          value={formatNumber(inTok + outTok, intl)}
          sub={`${t('costs.inputTokens')} ${formatNumber(inTok, intl)} · ${t('costs.outputTokens')} ${formatNumber(outTok, intl)}`}
        />
      </section>
      <ByDay data={data} />
      <section aria-label={t('costs.byUser')} className="grid gap-4 md:grid-cols-2">
        <Breakdown title={t('costs.byUser')} rows={data.by_user} currency={data.currency} />
        <Breakdown title={t('costs.byTeam')} rows={data.by_team} currency={data.currency} />
        <Breakdown title={t('costs.byAgent')} rows={data.by_agent} currency={data.currency} />
        <Breakdown title={t('costs.byModel')} rows={data.by_model} currency={data.currency} />
      </section>
      <Budgets data={data} />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle as="h3">{t('costs.recent')}</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          {data.recent.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted-foreground">{t('costs.empty')}</p>
          ) : (
            <Table label={t('costs.recent')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('costs.when')}</TableHead>
                  <TableHead>{t('costs.user')}</TableHead>
                  <TableHead>{t('costs.team')}</TableHead>
                  <TableHead>{t('costs.agent')}</TableHead>
                  <TableHead>{t('costs.model')}</TableHead>
                  <TableHead className="text-right">{t('costs.tokens')}</TableHead>
                  <TableHead className="text-right">{t('costs.eur')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((r, i) => (
                  <TableRow key={`${r.run_id}-${i}`}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{r.ts ? formatDateTime(r.ts, intl) : t('common.none')}</TableCell>
                    <TableCell>{r.user}</TableCell>
                    <TableCell>{r.team ?? t('common.none')}</TableCell>
                    <TableCell className="font-mono text-xs">{r.agent}</TableCell>
                    <TableCell className="font-mono text-xs">{r.model}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(r.input_tokens + r.output_tokens, intl)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEur(r.eur, intl, data.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle as="h3">{t('costs.prices')}</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <Table label={t('costs.prices')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('costs.model')}</TableHead>
                <TableHead className="text-right">{t('costs.inputTokens')}</TableHead>
                <TableHead className="text-right">{t('costs.outputTokens')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(data.prices).map(([model, p]) => (
                <TableRow key={model}>
                  <TableCell className="font-mono text-xs">{model}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEur(p.input_per_mtok, intl, data.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEur(p.output_per_mtok, intl, data.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function CostsPage() {
  const me = useMe();
  const { t, intl } = useI18n();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Costs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .costs(days)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [days, me.user]);

  return (
    <div className="container max-w-5xl py-8">
      <PageHeader
        title={t('costs.title')}
        description={t('costs.subtitle')}
        actions={
          data?.scope === 'all' ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('costs.period')}</span>
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-32">
                {[7, 30, 90, 365].map((d) => (
                  <option key={d} value={d}>
                    {t('costs.days', { days: d })}
                  </option>
                ))}
              </Select>
            </label>
          ) : null
        }
      />
      {error ? (
        <Alert variant="error">{t('common.error', { error })}</Alert>
      ) : !data ? (
        <Skeleton className="h-48" />
      ) : data.scope === 'me' ? (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t('costs.today')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-3xl font-semibold tabular-nums tracking-tight">{formatEur(data.today_eur, intl)}</p>
            {data.budget_daily_eur != null ? (
              <>
                <Meter value={data.today_eur} max={data.budget_daily_eur} label={t('costs.dailyBudget')} />
                <p className="text-sm text-muted-foreground">
                  {t('costs.dailyBudget')}: {t('costs.ofBudget', { used: formatEur(data.today_eur, intl), budget: formatEur(data.budget_daily_eur, intl) })}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('costs.noBudget')}</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <AllView data={data} days={days} />
      )}
    </div>
  );
}
