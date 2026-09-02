'use client';

/**
 * Reports — a cross-functional roll-up of every group in GET /admin/metrics.
 *
 * The dashboard shows the same figures as a flat grid of attention cards; this page shows
 * them grouped by operational area, so a reader scanning for "how are appointments doing"
 * vs "how is support doing" can find the section rather than sift. The data source is
 * identical: `readAdminMetrics`, whose server-side counts avoid the 100-row page ceiling.
 *
 * A MISSING GROUP IS NOT A ZERO. The server omits a group the caller lacks permission for,
 * and this page names the refusal in a withheld-sections block rather than drawing a card
 * with 0 in it — the same convention the dashboard uses, for the same reason: a zero would
 * be a lie about the data and indistinguishable from a genuinely empty organization.
 *
 * NO TIME-SERIES, NO TRENDS, NO FABRICATION. The metrics endpoint returns point-in-time
 * counts only. There is no period-over-period delta, no specialty distribution, no peak-hours
 * breakdown. This page shows counts and nothing else, because that is all the backend
 * computes. Inventing an arrow or a trend line would be the most quietly dishonest thing a
 * reports page can do.
 */

import { useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageHeader from '@/components/ui/page-header';
import StatCard from '@/components/ui/stat-card';
import SectionCard from '@/components/ui/section-card';
import {
  GROUP_LABEL,
  GROUP_PERMISSION,
  readAdminMetrics,
  type MetricGroup,
} from '@/lib/api/metrics';
import { formatSen } from '@/lib/api/directory';

const ALL_GROUPS: readonly MetricGroup[] = [
  'appointments',
  'emergencies',
  'support',
  'doctors',
  'revenue',
];

/**
 * The figures a section renders. `cards` may be empty even when the group is present, if the
 * group object exists but every interesting field is zero — though the current shapes always
 * carry at least one count.
 */
interface ReportSection {
  readonly group: MetricGroup;
  readonly title: string;
  readonly icon: string;
  readonly cards: ReadonlyArray<{
    readonly icon: string;
    readonly label: string;
    readonly value: string | number;
    readonly note?: string;
    readonly tone: 'blue' | 'red' | 'amber' | 'green' | 'purple' | 'teal' | 'slate';
  }>;
}

export default function ReportsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const metrics = useApiResource((signal) => readAdminMetrics(signal), []);

  const data = metrics.data?.data;
  const readable = useMemo(
    () => new Set(metrics.data?.readable_groups ?? []),
    [metrics.data],
  );
  const withheld = useMemo(
    () => ALL_GROUPS.filter((group) => !readable.has(group)),
    [readable],
  );

  // Build the sections from whatever groups the server actually returned. The order follows
  // ALL_GROUPS so a reader always sees the same sequence regardless of permission grants.
  const sections = useMemo<ReportSection[]>(() => {
    const built: ReportSection[] = [];

    if (data?.appointments) {
      built.push({
        group: 'appointments',
        title: 'Appointments',
        icon: 'event',
        cards: [
          {
            icon: 'event',
            label: 'Total',
            value: data.appointments.total.toLocaleString('en-MY'),
            note: 'All time, counted by the database',
            tone: 'blue',
          },
          {
            icon: 'schedule',
            label: 'Next 24 hours',
            value: data.appointments.starting_within_24h.toLocaleString('en-MY'),
            note: 'Rolling window, not a calendar day',
            tone: 'teal',
          },
          {
            icon: 'pending',
            label: 'Live',
            value: data.appointments.active.toLocaleString('en-MY'),
            note: 'Not yet concluded',
            tone: 'amber',
          },
        ],
      });
    }

    if (data?.emergencies) {
      built.push({
        group: 'emergencies',
        title: 'Emergency Dispatch',
        icon: 'emergency',
        cards: [
          {
            icon: 'emergency',
            label: 'Active',
            value: data.emergencies.active.toLocaleString('en-MY'),
            note: 'Awaiting resolution',
            tone: 'red',
          },
        ],
      });
    }

    if (data?.support) {
      built.push({
        group: 'support',
        title: 'Support',
        icon: 'support_agent',
        cards: [
          {
            icon: 'confirmation_number',
            label: 'Open tickets',
            value: data.support.open.toLocaleString('en-MY'),
            note: 'Not resolved or closed',
            tone: 'blue',
          },
          {
            icon: 'running_with_errors',
            label: 'Past due',
            value: data.support.breaching_resolution.toLocaleString('en-MY'),
            note: 'Beyond the resolution deadline',
            tone: 'red',
          },
        ],
      });
    }

    if (data?.doctors) {
      built.push({
        group: 'doctors',
        title: 'Medical Staff',
        icon: 'stethoscope',
        cards: [
          {
            icon: 'stethoscope',
            label: 'Listed',
            value: data.doctors.listed.toLocaleString('en-MY'),
            note: 'Approved doctors in the directory',
            tone: 'green',
          },
          {
            icon: 'person_add',
            label: 'Accepting new patients',
            value: data.doctors.accepting_new_patients.toLocaleString('en-MY'),
            note: 'Currently open to new patients',
            tone: 'purple',
          },
        ],
      });
    }

    if (data?.revenue) {
      built.push({
        group: 'revenue',
        title: 'Revenue',
        icon: 'payments',
        cards: [
          {
            icon: 'payments',
            label: 'Captured',
            value: formatSen(data.revenue.captured_sen, data.revenue.currency),
            // Named precisely: captured only, so the figure cannot include money that may
            // never arrive or money already returned.
            note: `From ${new Date(data.revenue.period_start).toLocaleDateString()}`,
            tone: 'green',
          },
        ],
      });
    }

    return built;
  }, [data]);

  const hasContent = sections.length > 0;

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Reports' }, { label: 'Overview' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Reports"
            subtitle="Cross-functional roll-up of database-counted figures for your organization. Only what your role permits."
          />

          <ResourceState
            isLoading={metrics.isLoading}
            error={metrics.error}
            isEmpty={!metrics.isLoading && !metrics.error && !hasContent}
            onRetry={metrics.reload}
            loadingLabel="Loading report figures…"
            forbiddenTitle="You cannot view report figures"
            errorTitle="Could not load report figures"
            emptyTitle="No figures available for your role"
            emptyBody="Your role does not permit any of the summarised areas."
            emptyIcon="query_stats"
          />

          {!metrics.isLoading && !metrics.error && hasContent && (
            <div className="flex flex-col gap-6">
              {sections.map((section) => (
                <SectionCard
                  key={section.group}
                  title={section.title}
                  action={
                    <span className="material-symbols-outlined text-slate-300 text-2xl">
                      {section.icon}
                    </span>
                  }
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {section.cards.map((card) => (
                      <StatCard
                        key={card.label}
                        icon={card.icon}
                        label={card.label}
                        value={card.value}
                        note={card.note}
                        tone={card.tone}
                      />
                    ))}
                  </div>
                </SectionCard>
              ))}
            </div>
          )}

          {/*
            The refusal is named rather than hidden. Silently dropping a section would leave a
            reader unable to tell "nothing to report" from "not permitted", which is the same
            collapse ResourceState exists to prevent, one level up.
          */}
          {!metrics.isLoading && !metrics.error && withheld.length > 0 && (
            <section
              className="rounded-xl border border-slate-200 bg-white p-5"
              aria-live="polite"
            >
              <h2 className="font-bold text-slate-900 text-sm">Not shown for your role</h2>
              <p className="text-xs text-slate-500 mt-1">
                These areas are withheld rather than shown as zero, so a blank figure is never
                mistaken for an empty one.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {withheld.map((group) => (
                  <li
                    key={group}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600"
                  >
                    <span className="material-symbols-outlined text-[16px] text-slate-400">
                      lock
                    </span>
                    <span className="font-bold">{GROUP_LABEL[group]}</span>
                    <code className="text-slate-400">{GROUP_PERMISSION[group]}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!metrics.isLoading && !metrics.error && data?.revenue && (
            <p className="text-xs text-slate-500">
              Revenue counts captured payments only. Pending payments are excluded because they
              may never arrive, and refunds because that money was returned.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
