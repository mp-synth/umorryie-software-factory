import { ArrowRight, CheckCircle2, FolderGit2, GraduationCap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { InboxItemIcon } from '@/components/InboxItemIcon';
import { ProposedRule } from '@/components/RulesPanel';
import { usePageMeta } from '@/components/shell/page-meta';
import { ButtonLink, Card, CardHeader, EmptyState, Page, PageHeader, Section, Skeleton } from '@/components/ui';
import { TONE } from '@/design/tone';
import type { InboxKind } from '@/lib/initiative';
import { useInbox, useInitiatives } from '@/lib/queries';
import { cn } from '@/lib/utils';

const KIND_LABELS: Record<InboxKind, string> = {
  approve: 'Plan to approve',
  questions: 'Questions to answer',
  failed: 'Planning failed',
  blocked: 'Tickets stopped',
};

export function InboxPage() {
  usePageMeta('Inbox');
  const { data: initiatives } = useInitiatives();
  const { items, rules: proposed, total, isLoading } = useInbox();
  const titleOf = (id: string | null) => initiatives?.find((i) => i.id === id)?.title;

  return (
    <Page width="narrow">
      <PageHeader
        title="Inbox"
        description={
          total
            ? `${total} thing${total > 1 ? 's' : ''} wait${total > 1 ? '' : 's'} on you, most urgent first. Agents keep working on everything else.`
            : 'Everything that waits on you shows up here, most urgent first.'
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ) : total === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 className="text-ink-good" />}
            title="You’re all caught up"
            actions={
              <ButtonLink to="/" variant="outline" end={<ArrowRight />}>
                See what the factory is doing
              </ButtonLink>
            }
          >
            Nothing waits on you. When a plan is ready for review, a planner has questions or a ticket stops, it lands here and in the sidebar.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-8">
          {items.length > 0 && (
            <Section title="Decisions" description="Each of these stopped and will not continue without you.">
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={`${item.kind}-${item.initiative.id}`}>
                    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                      <InboxItemIcon item={item} />
                      <div className="min-w-0 flex-1 basis-64">
                        <div className={cn('text-xs font-medium', TONE[item.tone].ink)}>{KIND_LABELS[item.kind]}</div>
                        <Link to={`/i/${item.initiative.id}`} className="mt-0.5 block truncate text-md font-medium text-ink hover:underline">
                          {item.title}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-secondary">
                          <span>{item.detail}</span>
                          <span className="flex items-center gap-1 text-xs text-ink-tertiary">
                            <FolderGit2 className="size-3.5" /> {item.initiative.projectName}
                          </span>
                        </div>
                      </div>
                      <ButtonLink to={item.to} variant="primary" end={<ArrowRight />}>
                        {item.cta}
                      </ButtonLink>
                    </Card>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {proposed.length > 0 && (
            <Section title="Learned rules to review" description="Retros learned these from your steering. Accept the ones agents should follow from now on.">
              <Card>
                <CardHeader icon={<GraduationCap />} title={`${proposed.length} proposed rule${proposed.length > 1 ? 's' : ''}`} />
                <div className="divide-y divide-line-subtle">
                  {proposed.map((r) => (
                    <ProposedRule
                      key={r.id}
                      rule={r}
                      source={
                        r.initiativeId ? (
                          <Link to={`/i/${r.initiativeId}?tab=rules`} className="hover:text-ink hover:underline">
                            {titleOf(r.initiativeId) ?? 'From a retro'}
                          </Link>
                        ) : (
                          'From a retro'
                        )
                      }
                    />
                  ))}
                </div>
              </Card>
            </Section>
          )}
        </div>
      )}
    </Page>
  );
}
