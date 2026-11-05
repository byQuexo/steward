import { Inbox, RefreshCw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ApprovalCard, type ApprovalView } from '@/components/approval-card';
import { Button } from '@/components/ui/button';
import { EmptyNote, PageHeader, SectionTitle, Skeleton } from '@/components/ui/misc';
import { useI18n } from '@/context/i18n';
import { useLive } from '@/context/live';
import { useMe } from '@/context/session';
import { useToast } from '@/context/toast';
import { api } from '@/lib/api';
import { bareTool } from '@/lib/timeline';
import type { Approval } from '@/lib/types';
import { errorMessage } from '@/lib/utils';

function view(a: Approval): ApprovalView {
  return {
    id: a.id,
    tool: bareTool(a.action),
    rule: a.rule,
    approvers: a.approvers,
    args: a.args,
    status: a.status,
    votes: a.votes,
    fourEyes: a.four_eyes,
    requester: a.requester,
    agent: a.act.length ? [...a.act, a.agent].join(' → ') : a.agent,
    act: a.act,
    created: a.created,
  };
}

export function ApprovalsPage() {
  const me = useMe();
  const { t } = useI18n();
  const { toast } = useToast();
  const { approvals, reload } = useLive();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const decide = async (id: string, decision: 'approve' | 'deny', reason: string) => {
    try {
      await api.decide(id, decision, reason);
      toast(t('approval.decided'), { variant: 'success' });
    } catch (e) {
      toast(t('approval.decideFailed', { error: errorMessage(e) }), { variant: 'error' });
    } finally {
      await reload();
    }
  };

  const readOnly = me.impersonated_by ? t('approval.testSession') : undefined;

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow={t('approval.heldBy')}
        title={t('approvals.title')}
        description={t('approvals.subtitle')}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'motion-safe:animate-spin' : undefined} aria-hidden />
            {t('approvals.refresh')}
          </Button>
        }
      />

      <section aria-labelledby="to-decide" className="mb-14">
        <SectionTitle id="to-decide" count={approvals?.to_decide.length} tone="approval">
          <Inbox className="h-3.5 w-3.5" aria-hidden />
          {t('approvals.toDecide')}
        </SectionTitle>
        {!approvals ? (
          <Skeleton className="h-40" />
        ) : approvals.to_decide.length === 0 ? (
          <EmptyNote icon={Inbox}>{t('approvals.noneToDecide')}</EmptyNote>
        ) : (
          <ul className="space-y-4">
            {approvals.to_decide.map((a, i) => (
              <li key={a.id}>
                <ApprovalCard
                  approval={view(a)}
                  active={i === 0}
                  headingLevel="h3"
                  onDecide={(d, reason) => decide(a.id, d, reason)}
                  decideDisabledReason={readOnly}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mine">
        <SectionTitle id="mine" count={approvals?.mine.length}>
          <Send className="h-3.5 w-3.5" aria-hidden />
          {t('approvals.mine')}
        </SectionTitle>
        <p className="-mt-2 mb-4 text-[13px] text-muted-foreground">{t('approval.selfNote')}</p>
        {!approvals ? (
          <Skeleton className="h-24" />
        ) : approvals.mine.length === 0 ? (
          <EmptyNote icon={Send}>{t('approvals.noneMine')}</EmptyNote>
        ) : (
          <ul className="space-y-4">
            {approvals.mine.map((a) => (
              <li key={a.id}>
                <ApprovalCard approval={view(a)} isRequester headingLevel="h3" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
