import { AlertTriangle, ArrowRight, Brain, BrainCircuit, CheckCircle2, CircleDashed, Clock, SearchX, Wallet, Wrench, XCircle } from 'lucide-react';

import { ApprovalCard } from '@/components/approval-card';
import { BotAvatar } from '@/components/avatars';
import { DecisionBadge } from '@/components/decision';
import { Badge } from '@/components/ui/badge';
import { Alert, ArgsTable } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import type { MessageKey } from '@/i18n';
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

function ToolRow({ item, turn }: { item: ToolItem; turn: Turn }) {
  const { t } = useI18n();
  const agentLabel = useAgentLabel();
  const approval = item.approvalId ? turn.items.find((x) => x.kind === 'approval' && x.approvalId === item.approvalId) : undefined;
  const waiting = approval?.kind === 'approval' && approval.status === 'pending';
  const denied = item.decision?.effect === 'deny';
  const status = item.result
    ? item.result.ok
      ? 'ok'
      : 'failed'
    : waiting
      ? 'waiting'
      : denied
        ? 'failed'
        : turn.status === 'streaming'
          ? 'running'
          : 'unknown';
  const StatusIcon = status === 'ok' ? CheckCircle2 : status === 'failed' ? XCircle : status === 'waiting' ? Clock : CircleDashed;
  const sub = item.agent && agentRole(item.agent) !== 'orchestrator';

  return (
    <div className={cn('flex gap-2.5', sub && 'ml-6 border-l pl-3')} data-testid="tool-item" data-tool={item.tool} data-status={status}>
      <BotAvatar seed={item.agent || 'assistant'} size={22} className="mt-0.5" title={agentLabel(item.agent)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1 text-sm">
            <Wrench className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t('act.tool')}: </span>
            <code className="font-mono text-[13px] font-medium">{item.tool}</code>
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
              'inline-flex items-center gap-1 text-xs',
              status === 'ok' && 'text-allow-foreground',
              status === 'failed' && 'text-deny-foreground',
              status === 'waiting' && 'text-approval-foreground',
              (status === 'running' || status === 'unknown') && 'text-muted-foreground',
            )}
          >
            <StatusIcon className={cn('h-3.5 w-3.5', status === 'running' && 'motion-safe:animate-spin')} aria-hidden />
            {status === 'ok' ? t('act.ok') : status === 'failed' ? t('act.failed') : status === 'waiting' ? t('act.waiting') : status === 'running' ? t('act.running') : null}
          </span>
          {sub && <span className="text-xs text-muted-foreground">{agentLabel(item.agent)}</span>}
        </div>
        {(item.args !== undefined || item.result) && (
          <details className="group mt-1">
            <summary className="w-fit cursor-pointer select-none rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="group-open:hidden">{t('act.showResult')}</span>
              <span className="hidden group-open:inline">{t('act.hideResult')}</span>
            </summary>
            <div className="mt-1.5 space-y-2 rounded-md border bg-muted/40 p-2.5">
              {item.args !== undefined && (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('act.args')}</p>
                  <ArgsTable args={item.args} label={t('act.args')} />
                </div>
              )}
              {item.result && (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('act.result')}</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs" tabIndex={0}>
                    {prettyPreview(item.result.preview)}
                  </pre>
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function HandoffRow({ item }: { item: HandoffItem }) {
  const { t } = useI18n();
  const agentLabel = useAgentLabel();
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-dashed bg-accent/40 px-2.5 py-2" title={t('act.handoffHint', { from: item.from, to: item.to })}>
      <BotAvatar seed={item.from} size={22} />
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <BotAvatar seed={item.to} size={22} />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{t('act.handoff', { to: agentLabel(item.to) })}</span>
        <code className="font-mono text-xs text-muted-foreground">{t('act.handoffSkill', { skill: item.skill })}</code>
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
            'inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs',
            item.variant === 'refused' ? 'border-deny/30 bg-deny-soft text-deny-foreground' : 'border-primary/20 bg-accent text-accent-foreground',
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

/** The per-turn activity: what the assistant did, and what Warden decided for each step. */
export function ActivityTimeline({ turn }: { turn: Turn }) {
  const items = turn.items.filter((x) => x.kind !== 'citation');
  if (items.length === 0) return null;
  const firstPending = items.find((x) => x.kind === 'approval' && x.status === 'pending');
  const activeApproval = firstPending?.kind === 'approval' ? firstPending.approvalId : undefined;
  return (
    <ol className="space-y-2" data-testid="activity">
      {items.map((item) => (
        <li key={item.key} className="animate-fade-in">
          <ItemView item={item} turn={turn} activeApproval={activeApproval} />
        </li>
      ))}
    </ol>
  );
}
