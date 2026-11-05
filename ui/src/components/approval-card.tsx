import { Check, Hand, MousePointerClick, Users, X } from 'lucide-react';
import { useId, useState } from 'react';

import { Beam } from '@/components/avatars';
import { ApprovalStatusBadge } from '@/components/decision';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { ArgsTable } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import type { ApprovalStatus, Vote } from '@/lib/types';
import { cn, formatRelative } from '@/lib/utils';

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

interface Props {
  approval: ApprovalView;
  /** Show approve/deny (inbox, the user is an approver). */
  onDecide?: (decision: 'approve' | 'deny', reason: string) => Promise<void>;
  /** The decide buttons are visible but disabled (test sessions). */
  decideDisabledReason?: string;
  /** The current user requested it (cannot approve). */
  isRequester?: boolean;
  /** Highlight with the ember border beam (the active pending card). */
  active?: boolean;
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

/**
 * A call Warden held for a human. Pending: ember eyebrow and hairline, the first one on screen
 * wears the ember border beam. Decided: monochrome except for its status chip.
 */
export function ApprovalCard({ approval: a, onDecide, decideDisabledReason, isRequester, active, headingLevel = 'h3', className }: Props) {
  const { t, intl } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const reasonId = useId();
  const headingId = useId();
  const Heading = headingLevel;
  const needed = a.fourEyes ? 2 : 1;
  const approvedVotes = a.votes.filter((v) => v.approve).length;
  const pending = a.status === 'pending';

  const decide = async (d: 'approve' | 'deny') => {
    if (!onDecide) return;
    setBusy(d);
    try {
      await onDecide(d, reason);
    } finally {
      setBusy(null);
    }
  };

  const card = (
    <article
      aria-labelledby={headingId}
      data-testid="approval-card"
      data-status={a.status}
      data-approval-id={a.id}
      className={cn('rounded-lg border bg-card p-5', pending && 'border-approval/50')}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('eyebrow', pending && 'text-approval-foreground')}>
            {t('approval.heldBy')} <span aria-hidden>·</span> <span className="normal-case tracking-normal">{a.rule}</span>
          </p>
          <Heading id={headingId} className="mt-2 text-[15px] font-medium leading-tight">
            <span className="sr-only">{t('approval.title')}: </span>
            <code className="font-mono text-[15px]">{a.tool}</code>
          </Heading>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            {t('approval.title')}
            {a.requester && <> · {t('approval.requester', { user: a.requester })}</>}
            {a.agent && (
              <>
                {' '}
                · <span className="font-mono text-[11.5px]">{t('approval.via', { agent: a.agent })}</span>
              </>
            )}
            {a.created ? <> · {formatRelative(a.created, intl)}</> : null}
          </p>
          <p className="sr-only">{t('approval.rule', { rule: a.rule })}</p>
        </div>
        <ApprovalStatusBadge status={a.status} />
      </div>

      <div className="mt-4 rounded-md border bg-muted/50 p-3.5">
        <p className="eyebrow mb-2.5">{t('approval.exactArgs')}</p>
        <ArgsTable args={a.args} label={t('act.args')} />
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{t('approval.argsHashNote')}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-3.5 w-3.5" aria-hidden />
          {t('approval.waitingFor', { approvers: a.approvers.join(', ') || t('common.none') })}
        </span>
        {a.fourEyes && (
          <span className="inline-flex items-center gap-2">
            <span className="font-medium">{t('approval.fourEyes')}</span>
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={needed}
              aria-valuenow={approvedVotes}
              aria-label={t('approval.fourEyesProgress', { done: approvedVotes, needed })}
              className="inline-flex gap-1"
            >
              {Array.from({ length: needed }, (_, i) => (
                <span key={i} className={cn('h-1 w-6 rounded-full', i < approvedVotes ? 'bg-allow' : 'bg-foreground/20')} />
              ))}
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {approvedVotes}/{needed}
            </span>
          </span>
        )}
      </div>

      {a.votes.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 text-[12px]" aria-label={t('approval.votes')}>
          {a.votes.map((v) => (
            <li
              key={v.user}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5',
                v.approve ? 'border-allow/35 bg-allow-soft text-allow-foreground' : 'border-deny/40 bg-deny-soft text-deny-foreground',
              )}
            >
              {v.approve ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
              {t(v.approve ? 'approval.votedApprove' : 'approval.votedDeny', { user: v.user })}
              {v.reason ? <span className="opacity-80">– {v.reason}</span> : null}
            </li>
          ))}
        </ul>
      )}

      {isRequester && pending && (
        <p className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Hand className="h-3.5 w-3.5" aria-hidden />
          {t('approval.selfNote')}
        </p>
      )}

      {onDecide && pending && (
        <div className="mt-5 space-y-3 border-t pt-5">
          <div className="space-y-2">
            <Label htmlFor={reasonId} className="text-[12.5px] text-muted-foreground">
              {t('approval.reason')}
            </Label>
            <Textarea
              id={reasonId}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('approval.reasonPlaceholder')}
              disabled={!!decideDisabledReason}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="allow" onClick={() => decide('approve')} disabled={!!busy || !!decideDisabledReason}>
              <Check aria-hidden />
              {t('approval.approve')}
            </Button>
            <Button variant="outline" className="text-deny-foreground hover:text-deny-foreground" onClick={() => decide('deny')} disabled={!!busy || !!decideDisabledReason}>
              <X aria-hidden />
              {t('approval.deny')}
            </Button>
            <span className="ml-1 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
              {decideDisabledReason ?? t('approval.clickOnly')}
            </span>
          </div>
        </div>
      )}
    </article>
  );

  // Always wrapped (so the card is never remounted when it becomes or stops being the active one).
  return (
    <Beam variant="held" active={pending && !!active} className={className}>
      {card}
    </Beam>
  );
}
