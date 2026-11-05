import { Ban, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/context/i18n';
import type { MessageKey } from '@/i18n';
import type { ApprovalStatus } from '@/lib/types';

function effectVariant(effect: string): 'allow' | 'approval' | 'deny' | 'muted' {
  if (effect === 'allow') return 'allow';
  if (effect === 'require_approval') return 'approval';
  if (effect === 'deny') return 'deny';
  return 'muted';
}

/** Warden's decision for one call: green allow, amber approval, red deny, with the rule id. */
export function DecisionBadge({ effect, rule, showRule = true }: { effect: string; rule?: string; showRule?: boolean }) {
  const { t } = useI18n();
  const variant = effectVariant(effect);
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
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
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
