// The gate: a call Warden held for a human, shown like an instrument block in the activity log
// (DESIGN.md §6). Pending: one mono header line with a live timer, the exact arguments, an ember
// left rule and a thin ember beam along the top edge. Resolved: collapses to one line.
// When it is the viewer's own turn (a write in their name) the gate asks them: run it or cancel.

import { Check, Pause, Play, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Beam } from '@/components/avatars';
import { Button } from '@/components/ui/button';
import { ArgsTable } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import { api } from '@/lib/api';
import { clock, useElapsed } from '@/lib/clock';
import type { ApprovalStatus, Awaiting, Vote } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ApprovalView {
  id: string;
  tool: string;
  rule: string;
  approvers: string[];
  args: unknown;
  status: ApprovalStatus;
  votes: Vote[];
  fourEyes?: boolean;
  requester?: string;
  agent?: string;
  act?: string[];
  created?: number;
  /** Whose turn it is; `requester` with `canConfirm` shows Run / Cancel. */
  awaiting?: Awaiting;
  /** A Warden confirmation (only the user decides). */
  confirmation?: boolean;
}

/** The decided voter (or the first approver) for the resolved line. */
function decider(a: ApprovalView): string {
  const want = a.status === 'approved';
  return a.votes.filter((v) => v.approve === want).slice(-1)[0]?.user ?? a.approvers[0] ?? '';
}

export function Gate({
  approval: a,
  active,
  className,
  canConfirm,
}: {
  approval: ApprovalView;
  active?: boolean;
  className?: string;
  /** The viewer is the requester: they may run or cancel while it is their turn. */
  canConfirm?: boolean;
}) {
  const { t } = useI18n();
  const started = useRef(a.created ? a.created * 1000 : Date.now());
  const [sending, setSending] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = a.status === 'pending';
  const elapsed = useElapsed(started.current, pending);
  const needed = a.fourEyes ? 2 : 1;
  const approvedVotes = a.votes.filter((v) => v.approve).length;
  const who = a.approvers.join(', ') || t('common.none');
  const yourTurn = pending && a.awaiting === 'requester';
  // Resolved while it was the requester's turn: they confirmed or cancelled it themselves.
  const ownDecision = a.awaiting === 'requester';

  const decide = async (decision: 'approve' | 'deny') => {
    setSending(decision);
    setError(null);
    try {
      await api.decide(a.id, decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(null);
    }
  };

  if (!pending) {
    const approved = a.status === 'approved';
    const denied = a.status === 'denied';
    const by = { who: decider(a) };
    const label = !approved && !denied
      ? t('gate.expired')
      : ownDecision
        ? t(approved ? 'gate.confirmedBy' : 'gate.cancelledBy', by)
        : t(approved ? 'gate.approvedBy' : 'gate.deniedBy', by);
    return (
      <div
        data-testid="approval-card"
        data-status={a.status}
        data-approval-id={a.id}
        className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 font-mono text-[12px]', className)}
      >
        <span className={cn('inline-flex items-center gap-1 font-medium', approved ? 'text-allow-foreground' : denied ? 'text-deny-foreground' : 'text-muted-foreground')}>
          {approved ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
          {label}
        </span>
        <span className="text-muted-foreground">
          · {t('gate.title').toUpperCase()} {a.tool} · <span className="tabular-nums">{clock(elapsed)}</span>
        </span>
      </div>
    );
  }

  return (
    <Beam variant="held" active={!!active} className={className}>
      <section
        aria-label={`${t('approval.title')}: ${a.tool}`}
        data-testid="approval-card"
        data-status={a.status}
        data-approval-id={a.id}
        className="relative rounded-[5px] border border-l-2 border-border border-l-approval bg-card/60"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 font-mono text-[11.5px]">
          <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.08em] text-approval-foreground">
            <Pause className="h-3 w-3 fill-current" aria-hidden />
            {yourTurn ? t('gate.confirmTitle') : t('gate.title')}
          </span>
          <span className="font-medium text-foreground">{a.tool}</span>
          <span className="truncate text-muted-foreground">
            <span className="sr-only">{t('act.rule')}: </span>
            {a.rule}
          </span>
          <span className="ml-auto inline-flex items-center gap-3 text-muted-foreground">
            <span>{yourTurn ? t('gate.waitingForYou') : t('gate.waitingFor', { who })}</span>
            {a.fourEyes && (
              <span
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={needed}
                aria-valuenow={approvedVotes}
                aria-label={t('approval.fourEyesProgress', { done: approvedVotes, needed })}
                className="tabular-nums text-foreground"
              >
                {approvedVotes}/{needed}
              </span>
            )}
            <span className="tabular-nums text-foreground" title={t('gate.elapsed')}>
              {clock(elapsed)}
            </span>
          </span>
        </div>
        <div className="px-3 py-2">
          <ArgsTable args={a.args} label={t('act.args')} />
        </div>
        {yourTurn && canConfirm ? (
          <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
            <p className="mr-auto text-[12px] text-muted-foreground">
              {t('gate.confirmAsk')}
              {!a.confirmation && a.approvers.length > 0 && ` ${t('gate.thenApprovers', { who })}`}
            </p>
            <Button size="sm" data-testid="gate-confirm" disabled={!!sending} onClick={() => decide('approve')}>
              <Play className="h-3.5 w-3.5" aria-hidden />
              {t('gate.run')}
            </Button>
            <Button size="sm" variant="outline" data-testid="gate-cancel" disabled={!!sending} onClick={() => decide('deny')}>
              <X className="h-3.5 w-3.5" aria-hidden />
              {t('gate.cancel')}
            </Button>
            {error && (
              <p role="alert" className="w-full text-[11.5px] text-deny-foreground">
                {error}
              </p>
            )}
          </div>
        ) : (
          <p className="border-t px-3 py-1 text-[11px] text-muted-foreground">
            {t('gate.note')} {a.confirmation ? t('gate.confirmNote') : t('approval.selfNote')}
          </p>
        )}
      </section>
    </Beam>
  );
}

/** Kept for existing imports: the gate is the approval card. */
export const ApprovalCard = Gate;
