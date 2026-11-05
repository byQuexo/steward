import { AlertTriangle, ArrowRight, Brain, BrainCircuit, Check, CircleDashed, Clock, CornerDownRight, SearchX, Wallet, X } from 'lucide-react';

import { ApprovalCard } from '@/components/approval-card';
import { AgentAvatar } from '@/components/avatars';
import { DecisionBadge, VerdictDot } from '@/components/decision';
import { Badge } from '@/components/ui/badge';
import { Alert, ArgsTable } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import type { MessageKey } from '@/i18n';
import { effectTone, type AgentRole, type VerdictTone } from '@/lib/look';
import { agentRole, type ActivityItem, type HandoffItem, type ToolItem, type Turn } from '@/lib/timeline';
import { cn, prettyPreview } from '@/lib/utils';

function useAgentLabel() {
  const { t } = useI18n();
  return (agent: string) => {
    if (!agent) return t('agent.orchestrator');
    const role = agentRole(agent);
    return t(`agent.${role}` as MessageKey);
  };
}

const isLocal = (tool: string) => !tool.includes('.');

type Status = 'ok' | 'failed' | 'waiting' | 'running' | 'unknown';

function toolStatus(item: ToolItem, turn: Turn): Status {
  const approval = item.approvalId ? turn.items.find((x) => x.kind === 'approval' && x.approvalId === item.approvalId) : undefined;
  const waiting = approval?.kind === 'approval' && approval.status === 'pending';
  const denied = item.decision?.effect === 'deny';
  return item.result ? (item.result.ok ? 'ok' : 'failed') : waiting ? 'waiting' : denied ? 'failed' : turn.status === 'streaming' ? 'running' : 'unknown';
}

/** The rail node of one step: the verdict's color (and shape) once Warden decided. */
function nodeTone(item: ActivityItem): VerdictTone {
  switch (item.kind) {
    case 'tool':
    case 'handoff':
      return effectTone(item.decision?.effect);
    case 'approval':
      return item.status === 'approved' ? 'allow' : item.status === 'pending' ? 'approval' : item.status === 'denied' ? 'deny' : 'muted';
    case 'memory':
      return item.variant === 'refused' ? 'deny' : 'muted';
    default:
      return 'muted';
  }
}

function ToolRow({ item, turn }: { item: ToolItem; turn: Turn }) {
  const { t } = useI18n();
  const agentLabel = useAgentLabel();
  const status = toolStatus(item, turn);
  const denied = item.decision?.effect === 'deny';
  const StatusIcon = status === 'ok' ? Check : status === 'failed' ? X : status === 'waiting' ? Clock : CircleDashed;
  const sub = item.agent && agentRole(item.agent) !== 'orchestrator';

  return (
    <div className={cn('min-w-0', sub && 'pl-5')} data-testid="tool-item" data-tool={item.tool} data-status={status}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {sub && <CornerDownRight className="-ml-5 h-3.5 w-3.5 text-subtle" aria-hidden />}
        <span className="inline-flex items-center">
          <span className="sr-only">{t('act.tool')}: </span>
          <code className="font-mono text-[13px] font-medium text-foreground">{item.tool}</code>
        </span>
        {item.decision ? (
          <DecisionBadge effect={item.decision.effect} rule={item.decision.rule} />
        ) : isLocal(item.tool) ? (
          <Badge variant="muted" title={t('act.localHint')}>
            {t('act.local')}
          </Badge>
        ) : null}
        <span
          className={cn(
            'inline-flex items-center gap-1 font-mono text-[11.5px]',
            status === 'failed' && denied ? 'text-deny-foreground' : status === 'waiting' ? 'text-approval-foreground' : status === 'failed' ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <StatusIcon className={cn('h-3 w-3', status === 'running' && 'motion-safe:animate-spin')} aria-hidden />
          {status === 'ok' ? t('act.ok') : status === 'failed' ? t('act.failed') : status === 'waiting' ? t('act.waiting') : status === 'running' ? t('act.running') : null}
        </span>
        {sub && <span className="font-mono text-[11.5px] text-muted-foreground">{agentLabel(item.agent)}</span>}
      </div>
      {(item.args !== undefined || item.result) && (
        <details className="group mt-1.5">
          <summary className="w-fit cursor-pointer select-none rounded font-mono text-[11.5px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="group-open:hidden">{t('act.showResult')}</span>
            <span className="hidden group-open:inline">{t('act.hideResult')}</span>
          </summary>
          <div className="mt-2 space-y-3 rounded-md border bg-muted/50 p-3">
            {item.args !== undefined && (
              <div>
                <p className="eyebrow mb-1.5">{t('act.args')}</p>
                <ArgsTable args={item.args} label={t('act.args')} />
              </div>
            )}
            {item.result && (
              <div>
                <p className="eyebrow mb-1.5">{t('act.result')}</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed" tabIndex={0}>
                  {prettyPreview(item.result.preview)}
                </pre>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function HandoffRow({ item }: { item: HandoffItem }) {
  const { t } = useI18n();
  const agentLabel = useAgentLabel();
  const role = agentRole(item.to) as AgentRole;
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-dashed px-3 py-2" title={t('act.handoffHint', { from: item.from, to: item.to })}>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      {role !== 'orchestrator' && <AgentAvatar role={role} size={18} paused />}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
        <span className="font-medium">{t('act.handoff', { to: agentLabel(item.to) })}</span>
        <code className="font-mono text-[11.5px] text-muted-foreground">{t('act.handoffSkill', { skill: item.skill })}</code>
        {item.decision && <DecisionBadge effect={item.decision.effect} rule={item.decision.rule} />}
        <span className="sr-only">{t('act.handoffHint', { from: item.from, to: item.to })}</span>
      </div>
    </div>
  );
}

function ItemView({ item, turn, activeApproval }: { item: ActivityItem; turn: Turn; activeApproval?: string }) {
  const { t } = useI18n();
  switch (item.kind) {
    case 'tool':
      return <ToolRow item={item} turn={turn} />;
    case 'handoff':
      return <HandoffRow item={item} />;
    case 'approval':
      return (
        <ApprovalCard
          approval={{
            id: item.approvalId,
            tool: item.tool,
            rule: item.rule,
            approvers: item.approvers,
            args: item.args,
            status: item.status,
            votes: item.votes,
          }}
          isRequester
          active={activeApproval === item.approvalId}
        />
      );
    case 'abstained':
      return (
        <Alert variant="info">
          <span className="inline-flex items-center gap-1.5">
            <SearchX className="h-3.5 w-3.5" aria-hidden />
            {t('act.abstained')}
          </span>
        </Alert>
      );
    case 'budget':
      return (
        <Alert variant="warning">
          <span className="inline-flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5" aria-hidden />
            {t('act.budget', { reason: item.text })}
          </span>
        </Alert>
      );
    case 'error':
      return (
        <Alert variant="error">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t('act.error', { message: item.text })}
          </span>
        </Alert>
      );
    case 'memory':
      return (
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px]',
            // A refused memory is a policy decision (deny); used/stored are plain facts.
            item.variant === 'refused' ? 'border-deny/40 bg-deny-soft text-deny-foreground' : 'bg-transparent text-muted-foreground',
          )}
        >
          {item.variant === 'used' ? <BrainCircuit className="h-3.5 w-3.5" aria-hidden /> : <Brain className="h-3.5 w-3.5" aria-hidden />}
          {item.variant === 'used'
            ? t('act.memoryUsed', { count: item.count ?? 0 })
            : item.variant === 'stored'
              ? t('act.memoryStored', { fact: item.text ?? '' })
              : t('act.memoryRefused', { reason: item.text ?? '' })}
        </span>
      );
    case 'citation':
      return null; // shown under the answer as sources
    default:
      return null;
  }
}

/**
 * The per-turn activity, shown like an instrument log: a hairline rail whose nodes light up in
 * the verdict color where Warden decided (DESIGN.md §6).
 */
export function ActivityTimeline({ turn }: { turn: Turn }) {
  const items = turn.items.filter((x) => x.kind !== 'citation');
  if (items.length === 0) return null;
  const firstPending = items.find((x) => x.kind === 'approval' && x.status === 'pending');
  const activeApproval = firstPending?.kind === 'approval' ? firstPending.approvalId : undefined;
  return (
    <ol className="relative space-y-3.5 border-l pl-5" data-testid="activity">
      {items.map((item) => {
        const tone = nodeTone(item);
        return (
          <li key={item.key} className="relative animate-fade-in">
            <span aria-hidden className="absolute -left-5 top-[7px] flex w-0 justify-center">
              <span className="flex h-[11px] w-[11px] items-center justify-center rounded-full bg-background">
                {tone === 'muted' ? <span className="h-[7px] w-[7px] rounded-full border border-subtle" /> : <VerdictDot tone={tone} />}
              </span>
            </span>
            <ItemView item={item} turn={turn} activeApproval={activeApproval} />
          </li>
        );
      })}
    </ol>
  );
}
