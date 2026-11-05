import { Ban, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/context/i18n';
import type { MessageKey } from '@/i18n';
import { effectTone, type VerdictTone } from '@/lib/look';
import type { Turn } from '@/lib/timeline';
import type { ApprovalStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Warden's decision for one call: teal allow, ember approval, red deny — plus the rule id. */
export function DecisionBadge({ effect, rule, showRule = true }: { effect: string; rule?: string; showRule?: boolean }) {
  const { t } = useI18n();
  const variant = effectTone(effect);
  const Icon = variant === 'allow' ? ShieldCheck : variant === 'approval' ? Clock : Ban;
  const key = `act.decision.${effect}` as MessageKey;
  const label = ['allow', 'deny', 'require_approval'].includes(effect) ? t(key) : effect;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={variant} title={rule ? t('act.decision.hint', { effect: label, rule }) : undefined}>
        <Icon aria-hidden />
        {label}
      </Badge>
      {showRule && rule && (
        <code className="font-mono text-[11.5px] text-muted-foreground">
          <span className="sr-only">{t('act.rule')}: </span>
          {rule}
        </code>
      )}
    </span>
  );
}

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const { t } = useI18n();
  const variant = status === 'approved' ? 'allow' : status === 'pending' ? 'approval' : status === 'denied' ? 'deny' : 'muted';
  const Icon = status === 'approved' ? CheckCircle2 : status === 'pending' ? Clock : Ban;
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {t(`approval.${status}`)}
    </Badge>
  );
}

const DOT: Record<VerdictTone, string> = {
  allow: 'bg-allow',
  approval: 'bg-approval',
  deny: 'bg-deny',
  muted: 'bg-subtle',
};

/** A small verdict dot (rail node, trail tick). Shape doubles the color: ● allow, ◆ held, ✕-ish bar deny. */
export function VerdictDot({ tone, className }: { tone: VerdictTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0',
        tone === 'approval' ? 'h-[7px] w-[7px] rotate-45 rounded-[1.5px]' : tone === 'deny' ? 'h-[3px] w-[9px] rounded-full' : 'h-[7px] w-[7px] rounded-full',
        DOT[tone],
        className,
      )}
    />
  );
}

/** The verdict trail: one tick per Warden decision in a turn, in order (DESIGN.md §1). */
export function VerdictTrail({ turn }: { turn: Turn }) {
  const { t } = useI18n();
  const tones = turn.items
    .filter((x) => (x.kind === 'tool' || x.kind === 'handoff') && x.decision)
    .map((x) => effectTone(x.kind === 'tool' || x.kind === 'handoff' ? x.decision?.effect : undefined))
    .filter((x) => x !== 'muted');
  if (tones.length === 0) return null;
  const count = (k: VerdictTone) => tones.filter((x) => x === k).length;
  const summary = t('trail.summary', { count: tones.length, allow: count('allow'), approval: count('approval'), deny: count('deny') });
  return (
    <span className="inline-flex items-center gap-1.5" title={summary} data-testid="verdict-trail">
      <span className="sr-only">{summary}</span>
      {tones.map((tone, i) => (
        <VerdictDot key={i} tone={tone} />
      ))}
    </span>
  );
}
