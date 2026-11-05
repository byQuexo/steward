// The gate: a call Warden held for a human, shown like an instrument block in the activity log
// (DESIGN.md §6). Pending: one mono header line with a live timer, the exact arguments, an ember
// left rule and a thin ember beam along the top edge. Resolved: collapses to one line.

import { Check, Pause, X } from 'lucide-react';
import { useRef } from 'react';

import { Beam } from '@/components/avatars';
import { ArgsTable } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import { clock, useElapsed } from '@/lib/clock';
import type { ApprovalStatus, Vote } from '@/lib/types';
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
}

/** The decided voter (or the first approver) for the resolved line. */
function decider(a: ApprovalView): string {
  const want = a.status === 'approved';
  return a.votes.filter((v) => v.approve === want).slice(-1)[0]?.user ?? a.approvers[0] ?? '';
}

export function Gate({ approval: a, active, className }: { approval: ApprovalView; active?: boolean; className?: string }) {
  const { t } = useI18n();
  const started = useRef(a.created ? a.created * 1000 : Date.now());
  const pending = a.status === 'pending';
  const elapsed = useElapsed(started.current, pending);
  const needed = a.fourEyes ? 2 : 1;
  const approvedVotes = a.votes.filter((v) => v.approve).length;
  const who = a.approvers.join(', ') || t('common.none');

  if (!pending) {
    const approved = a.status === 'approved';
    const denied = a.status === 'denied';
    return (
      <div
        data-testid="approval-card"
        data-status={a.status}
        data-approval-id={a.id}
        className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 font-mono text-[12px]', className)}
      >
        <span className={cn('inline-flex items-center gap-1 font-medium', approved ? 'text-allow-foreground' : denied ? 'text-deny-foreground' : 'text-muted-foreground')}>
          {approved ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
          {approved ? t('gate.approvedBy', { who: decider(a) }) : denied ? t('gate.deniedBy', { who: decider(a) }) : t('gate.expired')}
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
            {t('gate.title')}
          </span>
          <span className="font-medium text-foreground">{a.tool}</span>
          <span className="truncate text-muted-foreground">
            <span className="sr-only">{t('act.rule')}: </span>
            {a.rule}
          </span>
          <span className="ml-auto inline-flex items-center gap-3 text-muted-foreground">
            <span>{t('gate.waitingFor', { who })}</span>
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
        <p className="border-t px-3 py-1 text-[11px] text-muted-foreground">
          {t('gate.note')} {t('approval.selfNote')}
        </p>
      </section>
    </Beam>
  );
}

/** Kept for existing imports: the gate is the approval card. */
export const ApprovalCard = Gate;
