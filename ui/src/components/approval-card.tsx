import { Check, Hand, MousePointerClick, ShieldAlert, Users, X } from 'lucide-react';
import { useId, useState } from 'react';

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
  /** Highlight with the border beam (the active pending card). */
  active?: boolean;
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

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

  return (
    <article
      aria-labelledby={headingId}
      data-testid="approval-card"
      data-status={a.status}
      data-approval-id={a.id}
      className={cn(
        'rounded-lg border bg-card p-4 shadow-sm',
        pending ? 'border-approval/50' : a.status === 'approved' ? 'border-allow/40' : a.status === 'denied' ? 'border-deny/40' : '',
        pending && active && 'border-beam border-transparent',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
              pending ? 'bg-approval-soft text-approval-foreground' : 'bg-muted text-muted-foreground',
            )}
            aria-hidden
          >
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <Heading id={headingId} className="text-sm font-semibold leading-tight">
              {t('approval.title')}: <code className="font-mono">{a.tool}</code>
            </Heading>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('approval.rule', { rule: a.rule })}
              {a.requester && <> · {t('approval.requester', { user: a.requester })}</>}
              {a.agent && <> · {t('approval.via', { agent: a.agent })}</>}
              {a.created ? <> · {formatRelative(a.created, intl)}</> : null}
            </p>
          </div>
        </div>
        <ApprovalStatusBadge status={a.status} />
      </div>

      <div className="mt-3 rounded-md border bg-muted/40 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t('approval.exactArgs')}</p>
        <ArgsTable args={a.args} label={t('act.args')} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('approval.argsHashNote')}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
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
                <span key={i} className={cn('h-1.5 w-6 rounded-full', i < approvedVotes ? 'bg-allow' : 'bg-muted-foreground/30')} />
              ))}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {approvedVotes}/{needed}
            </span>
          </span>
        )}
      </div>

      {a.votes.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2 text-xs" aria-label={t('approval.votes')}>
          {a.votes.map((v) => (
            <li
              key={v.user}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
                v.approve ? 'border-allow/30 bg-allow-soft text-allow-foreground' : 'border-deny/30 bg-deny-soft text-deny-foreground',
              )}
            >
              {v.approve ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
              {t(v.approve ? 'approval.votedApprove' : 'approval.votedDeny', { user: v.user })}
              {v.reason ? <span className="text-muted-foreground">– {v.reason}</span> : null}
            </li>
          ))}
        </ul>
      )}

      {isRequester && pending && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Hand className="h-3.5 w-3.5" aria-hidden />
          {t('approval.selfNote')}
        </p>
      )}

      {onDecide && pending && (
        <div className="mt-4 space-y-3 border-t pt-4">
          <div className="space-y-1.5">
            <Label htmlFor={reasonId} className="text-xs">
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
            <Button variant="outline" className="text-deny-foreground" onClick={() => decide('deny')} disabled={!!busy || !!decideDisabledReason}>
              <X aria-hidden />
              {t('approval.deny')}
            </Button>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
              {decideDisabledReason ?? t('approval.clickOnly')}
            </span>
          </div>
        </div>
      )}
    </article>
  );
}
