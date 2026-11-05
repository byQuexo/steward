import { AlertTriangle, ArrowRight, Brain, BrainCircuit, ChevronRight, SearchX, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';

import { Gate } from '@/components/approval-card';
import { AgentAvatar } from '@/components/avatars';
import { VerdictDot } from '@/components/decision';
import { ArgsTable } from '@/components/ui/misc';
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

const VERDICT_TEXT: Record<VerdictTone, string> = {
  allow: 'text-allow-foreground',
  approval: 'text-approval-foreground',
  deny: 'text-deny-foreground',
  muted: 'text-muted-foreground',
};

/** One call = one log line: dot · tool · verdict · rule · ran/not run. The result expands on click. */
function ToolRow({ item, turn }: { item: ToolItem; turn: Turn }) {
  const { t } = useI18n();
  const agentLabel = useAgentLabel();
  const status = toolStatus(item, turn);
  const effect = item.decision?.effect;
  const tone = effectTone(effect);
  const verdict = effect && ['allow', 'deny', 'require_approval'].includes(effect) ? t(`act.decision.${effect}` as MessageKey) : effect;
  const sub = item.agent && agentRole(item.agent) !== 'orchestrator';
  const hasDetail = item.args !== undefined || !!item.result;
  const statusText =
    status === 'ok' ? t('act.ok') : status === 'failed' ? t('act.failed') : status === 'waiting' ? t('act.waiting') : status === 'running' ? t('act.running') : '';

  const line = (
    <>
      {item.decision ? <VerdictDot tone={tone} /> : <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-full border border-subtle" />}
      <span className="sr-only">{t('act.tool')}: </span>
      <code className="shrink-0 font-mono text-[12.5px] font-medium text-foreground">{item.tool}</code>
      {item.decision ? (
        <>
          <span className={cn('shrink-0 text-[12.5px] font-medium', VERDICT_TEXT[tone])} title={t('act.decision.hint', { effect: verdict ?? '', rule: item.decision.rule })}>
            {verdict}
          </span>
          <code className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">
            <span className="sr-only">{t('act.rule')}: </span>
            {item.decision.rule}
          </code>
        </>
      ) : isLocal(item.tool) ? (
        <span className="text-[12px] text-muted-foreground" title={t('act.localHint')}>
          {t('act.local')}
        </span>
      ) : null}
      {statusText && (
        <span
          className={cn(
            'shrink-0 font-mono text-[11.5px]',
            status === 'failed' && effect === 'deny' ? 'text-deny-foreground' : status === 'waiting' ? 'text-approval-foreground' : 'text-muted-foreground',
            status === 'running' && 'motion-safe:animate-pulse',
          )}
        >
          · {statusText}
        </span>
      )}
      {sub && <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">· {agentLabel(item.agent)}</span>}
    </>
  );

  return (
    <div className={cn('min-w-0', sub && 'pl-4')} data-testid="tool-item" data-tool={item.tool} data-status={status}>
      {hasDetail ? (
        <details className="group">
          <summary className="-mx-1.5 flex min-h-7 cursor-pointer list-none items-center gap-2 rounded px-1.5 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            {line}
            <span className="ml-auto inline-flex shrink-0 items-center pl-2 text-muted-foreground" title={t('act.showResult')}>
              <span className="sr-only group-open:hidden">{t('act.showResult')}</span>
              <span className="sr-only hidden group-open:inline">{t('act.hideResult')}</span>
              <ChevronRight className="h-3.5 w-3.5 transition-transform duration-micro group-open:rotate-90" aria-hidden />
            </span>
          </summary>
          <div className="mb-1.5 ml-3.5 mt-1 space-y-2.5 rounded-[5px] border bg-muted/40 px-3 py-2">
            {item.args !== undefined && (
              <div>
                <p className="eyebrow mb-1">{t('act.args')}</p>
                <ArgsTable args={item.args} label={t('act.args')} />
              </div>
            )}
            {item.result && (
              <div>
                <p className="eyebrow mb-1">{t('act.result')}</p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed" tabIndex={0}>
                  {prettyPreview(item.result.preview)}
                </pre>
              </div>
            )}
          </div>
        </details>
      ) : (
        <div className="flex min-h-7 items-center gap-2">{line}</div>
      )}
    </div>
  );
}

function HandoffRow({ item }: { item: HandoffItem }) {
  const { t } = useI18n();
  const agentLabel = useAgentLabel();
  const role = agentRole(item.to) as AgentRole;
  const tone = effectTone(item.decision?.effect);
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-2 text-[12.5px]" title={t('act.handoffHint', { from: item.from, to: item.to })}>
      {item.decision ? <VerdictDot tone={tone} /> : <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-full border border-subtle" />}
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {role !== 'orchestrator' && <AgentAvatar role={role} size={16} paused />}
      <span className="shrink-0 font-medium">{t('act.handoff', { to: agentLabel(item.to) })}</span>
      <code className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">{t('act.handoffSkill', { skill: item.skill })}</code>
      {item.decision && (
        <span className={cn('shrink-0 font-medium', VERDICT_TEXT[tone])}>
          {t(`act.decision.${item.decision.effect}` as MessageKey)}
        </span>
      )}
      <span className="sr-only">{t('act.handoffHint', { from: item.from, to: item.to })}</span>
    </div>
  );
}

function Note({ icon: Icon, children, tone }: { icon: typeof Brain; children: ReactNode; tone?: 'deny' | 'fault' }) {
  return (
    <p
      className={cn(
        'flex min-h-7 items-center gap-2 text-[12.5px]',
        tone === 'deny' ? 'text-deny-foreground' : tone === 'fault' ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
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
        <Gate
          approval={{
            id: item.approvalId,
            tool: item.tool,
            rule: item.rule,
            approvers: item.approvers,
            args: item.args,
            status: item.status,
            votes: item.votes,
          }}
          active={activeApproval === item.approvalId}
          className="my-1.5"
        />
      );
    case 'abstained':
      return <Note icon={SearchX}>{t('act.abstained')}</Note>;
    case 'budget':
      return (
        <Note icon={Wallet} tone="fault">
          {t('act.budget', { reason: item.text })}
        </Note>
      );
    case 'error':
      return (
        <Note icon={AlertTriangle} tone="fault">
          {t('act.error', { message: item.text })}
        </Note>
      );
    case 'memory':
      return (
        // A refused memory is a policy decision (deny); used/stored are plain facts.
        <Note icon={item.variant === 'used' ? BrainCircuit : Brain} tone={item.variant === 'refused' ? 'deny' : undefined}>
          {item.variant === 'used'
            ? t('act.memoryUsed', { count: item.count ?? 0 })
            : item.variant === 'stored'
              ? t('act.memoryStored', { fact: item.text ?? '' })
              : t('act.memoryRefused', { reason: item.text ?? '' })}
        </Note>
      );
    case 'citation':
      return null; // shown under the answer as sources
    default:
      return null;
  }
}

/**
 * The per-turn activity, shown like an instrument log: one line per step, the verdict color on
 * the dot and the word where Warden decided (DESIGN.md §6).
 */
export function ActivityTimeline({ turn }: { turn: Turn }) {
  const items = turn.items.filter((x) => x.kind !== 'citation');
  if (items.length === 0) return null;
  const firstPending = items.find((x) => x.kind === 'approval' && x.status === 'pending');
  const activeApproval = firstPending?.kind === 'approval' ? firstPending.approvalId : undefined;
  return (
    <ol className="border-l pl-3" data-testid="activity">
      {items.map((item) => (
        <li key={item.key} className="animate-fade-in">
          <ItemView item={item} turn={turn} activeApproval={activeApproval} />
        </li>
      ))}
    </ol>
  );
}
