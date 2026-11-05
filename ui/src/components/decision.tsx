import { useI18n } from '@/context/i18n';
import type { MessageKey } from '@/i18n';
import { effectTone, type VerdictTone } from '@/lib/look';
import type { Turn } from '@/lib/timeline';
import type { ApprovalStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const TEXT: Record<VerdictTone, string> = {
  allow: 'text-allow-foreground',
  approval: 'text-approval-foreground',
  deny: 'text-deny-foreground',
  muted: 'text-muted-foreground',
};

/**
 * Warden's decision for one call, as a log line fragment: verdict dot · verdict word · rule id.
 * No pill: the color of the dot and the word is the whole signal (DESIGN.md §6).
 */
export function DecisionBadge({ effect, rule, showRule = true }: { effect: string; rule?: string; showRule?: boolean }) {
  const { t } = useI18n();
  const tone = effectTone(effect);
  const key = `act.decision.${effect}` as MessageKey;
  const label = ['allow', 'deny', 'require_approval'].includes(effect) ? t(key) : effect;
  return (
    <span className="inline-flex min-w-0 items-center gap-2" title={rule ? t('act.decision.hint', { effect: label, rule }) : undefined}>
      <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium', TEXT[tone])}>
        <VerdictDot tone={tone} />
        {label}
      </span>
      {showRule && rule && (
        <code className="truncate font-mono text-[11.5px] text-muted-foreground">
          <span className="sr-only">{t('act.rule')}: </span>
          {rule}
        </code>
      )}
    </span>
  );
}

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const { t } = useI18n();
  const tone: VerdictTone = status === 'approved' ? 'allow' : status === 'pending' ? 'approval' : status === 'denied' ? 'deny' : 'muted';
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium', TEXT[tone])}>
      <VerdictDot tone={tone} />
      {t(`approval.${status}`)}
    </span>
  );
}

const DOT: Record<VerdictTone, string> = {
  allow: 'bg-allow',
  approval: 'bg-approval',
  deny: 'bg-deny',
  muted: 'bg-subtle',
};

/** A small verdict mark (rail node, trail tick). Shape doubles the color: ● allow, ◆ held, ▬ deny. */
export function VerdictDot({ tone, className }: { tone: VerdictTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0',
        tone === 'approval' ? 'h-[6px] w-[6px] rotate-45 rounded-[1px]' : tone === 'deny' ? 'h-[2.5px] w-[8px] rounded-full' : 'h-[6px] w-[6px] rounded-full',
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
