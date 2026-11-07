import { Check, Pause, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import type { ApprovalView } from '@/components/approval-card';
import { ApprovalStatusBadge } from '@/components/decision';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArgsTable, EmptyNote, PageHeader, SectionTitle, Skeleton } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import { useLive } from '@/context/live';
import { useMe } from '@/context/session';
import { useToast } from '@/context/toast';
import { api } from '@/lib/api';
import { clock } from '@/lib/clock';
import { bareTool } from '@/lib/timeline';
import type { Approval } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';

function view(a: Approval): ApprovalView {
  return {
    id: a.id,
    tool: bareTool(a.action),
    rule: a.rule,
    approvers: a.approvers,
    args: a.args,
    status: a.status,
    votes: a.votes,
    fourEyes: a.four_eyes,
    requester: a.requester,
    agent: a.act.length ? [...a.act, a.agent].join(' → ') : a.agent,
    act: a.act,
    created: a.created,
  };
}

/** Ticks once a second so ages stay live. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const age = (a: ApprovalView, now: number) => (a.created ? clock(now - a.created * 1000) : '–');

function FourEyes({ a }: { a: ApprovalView }) {
  const { t } = useI18n();
  if (!a.fourEyes) return null;
  const done = a.votes.filter((v) => v.approve).length;
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={2}
      aria-valuenow={done}
      aria-label={t('approval.fourEyesProgress', { done, needed: 2 })}
      title={t('approval.fourEyes')}
      className="font-mono text-[11.5px] tabular-nums text-foreground"
    >
      {done}/2
    </span>
  );
}

export function ApprovalsPage() {
  const me = useMe();
  const { t } = useI18n();
  const { toast } = useToast();
  const { approvals, reload } = useLive();
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const reasonId = useId();
  const now = useNow();
  const rows = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    void reload();
  }, [reload]);

  const toDecide = useMemo(() => (approvals?.to_decide ?? []).map(view), [approvals]);
  const mine = useMemo(() => (approvals?.mine ?? []).map(view), [approvals]);
  const current = toDecide.find((a) => a.id === selected) ?? toDecide[0];
  const readOnly = me.impersonated_by ? t('approval.testSession') : undefined;

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const decide = useCallback(
    async (id: string, decision: 'approve' | 'deny') => {
      setBusy(id);
      try {
        await api.decide(id, decision, reasons[id] ?? '');
        toast(t('approval.decided'), { variant: 'success' });
      } catch (e) {
        toast(t('approval.decideFailed', { error: errorMessage(e) }), { variant: 'error' });
      } finally {
        setBusy(null);
        await reload();
      }
    },
    [reasons, reload, t, toast],
  );

  // Keyboard: j/k move through the gates, ⏎ approves the selected one (never inside a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest('input, textarea, select, button, a, summary, [contenteditable="true"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey || toDecide.length === 0) return;
      const i = Math.max(0, toDecide.findIndex((a) => a.id === current?.id));
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const next = toDecide[Math.min(toDecide.length - 1, Math.max(0, i + (e.key === 'j' ? 1 : -1)))];
        if (next) {
          setSelected(next.id);
          rows.current[next.id]?.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter' && current && !readOnly && !busy) {
        e.preventDefault();
        void decide(current.id, 'approve');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toDecide, current, readOnly, busy, decide]);

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-6 sm:px-6">
      <PageHeader
        title={t('approvals.title')}
        description={t('approvals.subtitle')}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'motion-safe:animate-spin' : undefined} aria-hidden />
            {t('approvals.refresh')}
          </Button>
        }
      />

      <section aria-labelledby="to-decide" className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <SectionTitle id="to-decide" count={toDecide.length} tone="approval">
            {t('approvals.toDecide')}
          </SectionTitle>
          {toDecide.length > 0 && <p className="hidden font-mono text-[11px] text-muted-foreground sm:block">{t('gate.keys')}</p>}
        </div>
        {!approvals ? (
          <Skeleton className="h-28" />
        ) : toDecide.length === 0 ? (
          <EmptyNote icon={Pause}>{t('approvals.noneToDecide')}</EmptyNote>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="overflow-hidden rounded-md border">
              <div
                aria-hidden
                className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_44px_auto] items-center gap-3 border-b bg-muted/40 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground md:grid"
              >
                <span>{t('gate.tool')}</span>
                <span>{t('gate.requester')}</span>
                <span>{t('gate.rule')}</span>
                <span className="text-right">{t('gate.age')}</span>
                <span className="w-[164px]" />
              </div>
              {toDecide.map((a) => {
                const isSel = a.id === current?.id;
                return (
                  <div
                    key={a.id}
                    ref={(el) => {
                      rows.current[a.id] = el;
                    }}
                    data-testid="approval-card"
                    data-status={a.status}
                    data-approval-id={a.id}
                    onClick={() => setSelected(a.id)}
                    className={cn(
                      'relative grid cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-[13px] last:border-b-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_44px_auto]',
                      isSel ? 'bg-accent/60' : 'hover:bg-accent/30',
                    )}
                  >
                    {isSel && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-approval" />}
                    <button
                      type="button"
                      onClick={() => setSelected(a.id)}
                      aria-current={isSel || undefined}
                      aria-label={t('gate.select', { tool: a.tool, user: a.requester ?? '' })}
                      className="flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span aria-hidden className="h-[6px] w-[6px] shrink-0 rotate-45 rounded-[1px] bg-approval" />
                      <code className="truncate font-mono text-[12.5px] font-medium">{a.tool}</code>
                      <FourEyes a={a} />
                    </button>
                    <span className="hidden truncate md:block">{a.requester}</span>
                    <code className="hidden truncate font-mono text-[11.5px] text-muted-foreground md:block">{a.rule}</code>
                    <span className="hidden text-right font-mono text-[11.5px] tabular-nums text-muted-foreground md:block">{age(a, now)}</span>
                    <span className="flex items-center justify-end gap-1.5">
                      <span className="mr-1 truncate text-[12px] text-muted-foreground md:hidden">{a.requester}</span>
                      <Button size="sm" variant="allow" onClick={() => void decide(a.id, 'approve')} disabled={!!busy || !!readOnly} title={readOnly}>
                        <Check aria-hidden />
                        {a.awaiting === 'requester' ? t('gate.run') : t('approval.approve')}
                        {isSel && <kbd aria-hidden className="ml-0.5 border-allow-ink/30 bg-transparent text-allow-ink">⏎</kbd>}
                      </Button>
                      <Button size="sm" variant="outline" className="text-deny-foreground hover:text-deny-foreground" onClick={() => void decide(a.id, 'deny')} disabled={!!busy || !!readOnly} title={readOnly}>
                        <X aria-hidden />
                        {a.awaiting === 'requester' ? t('gate.cancel') : t('approval.deny')}
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>

            {current && (
              <aside aria-label={`${t('approval.title')}: ${current.tool}`} className="rounded-md border border-l-2 border-l-approval lg:sticky lg:top-4">
                <div className="flex items-center gap-2 border-b px-3 py-1.5 font-mono text-[11.5px]">
                  <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.08em] text-approval-foreground">
                    <Pause className="h-3 w-3 fill-current" aria-hidden />
                    {t('gate.title')}
                  </span>
                  <span className="truncate font-medium">{current.tool}</span>
                  <span className="ml-auto tabular-nums">{age(current, now)}</span>
                </div>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 border-b px-3 py-2 text-[12.5px]">
                  <dt className="text-muted-foreground">{t('gate.requester')}</dt>
                  <dd>{current.requester}</dd>
                  <dt className="text-muted-foreground">{t('gate.rule')}</dt>
                  <dd className="font-mono text-[11.5px]">{current.rule}</dd>
                  {current.agent && (
                    <>
                      <dt className="text-muted-foreground">{t('audit.agent')}</dt>
                      <dd className="font-mono text-[11.5px]">{current.agent}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">{t('approval.votes')}</dt>
                  <dd className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {current.fourEyes && <FourEyes a={current} />}
                    {current.votes.length === 0 ? (
                      <span className="text-muted-foreground">{t('common.none')}</span>
                    ) : (
                      current.votes.map((v) => (
                        <span key={v.user} className={v.approve ? 'text-allow-foreground' : 'text-deny-foreground'}>
                          {v.approve ? '✓' : '✗'} {v.user}
                        </span>
                      ))
                    )}
                  </dd>
                </dl>
                <div className="border-b px-3 py-2">
                  <p className="eyebrow mb-1.5">{t('approval.exactArgs')}</p>
                  <ArgsTable args={current.args} label={t('act.args')} />
                </div>
                <div className="space-y-1.5 px-3 py-2">
                  <Label htmlFor={reasonId} className="text-[12px] text-muted-foreground">
                    {t('approval.reason')}
                  </Label>
                  <Textarea
                    id={reasonId}
                    rows={2}
                    value={reasons[current.id] ?? ''}
                    onChange={(e) => setReasons((r) => ({ ...r, [current.id]: e.target.value }))}
                    placeholder={t('approval.reasonPlaceholder')}
                    disabled={!!readOnly}
                    className="min-h-0 text-[12.5px]"
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{readOnly ?? t('gate.note')}</p>
                </div>
              </aside>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="mine">
        <SectionTitle id="mine" count={mine.length}>
          {t('approvals.mine')}
        </SectionTitle>
        {!approvals ? (
          <Skeleton className="h-16" />
        ) : mine.length === 0 ? (
          <EmptyNote>{t('approvals.noneMine')}</EmptyNote>
        ) : (
          <ul className="overflow-hidden rounded-md border">
            {mine.map((a) => (
              <li
                key={a.id}
                data-testid="approval-card"
                data-status={a.status}
                data-approval-id={a.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b px-3 py-2 text-[13px] last:border-b-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_44px]"
              >
                <code className="truncate font-mono text-[12.5px] font-medium">{a.tool}</code>
                <code className="hidden truncate font-mono text-[11.5px] text-muted-foreground md:block">{a.rule}</code>
                <ApprovalStatusBadge status={a.status} />
                <span className="hidden text-right font-mono text-[11.5px] tabular-nums text-muted-foreground md:block">{age(a, now)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[12px] text-muted-foreground">{t('approval.selfNote')}</p>
      </section>
    </div>
  );
}
