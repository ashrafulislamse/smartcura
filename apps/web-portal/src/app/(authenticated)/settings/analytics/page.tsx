'use client';

/**
 * Platform Analytics — a de-mocked settings page backed by GET /admin/metrics.
 *
 * REMOVED FROM THE MOCK, deliberately and without substitutes:
 *   - the "User Growth" SVG line chart — a hardcoded path with a fake "2,845 Users" tooltip.
 *     No endpoint returns a time-series of registrations, so a trend line would be invented
 *     shape, not data. Drawing one is the most quietly dishonest thing an analytics page can
 *     do.
 *   - the "Top Specialties" horizontal bars (Cardiology 35%, Pediatrics 28%, Orthopedics
 *     22%, Dermatology 15%) — no endpoint returns a specialty distribution. The percentages
 *     summed to 100 by construction, which is how you can tell they were authored, not
 *     measured.
 *   - the "Peak Hours" donut chart (Morning 40%, Afternoon 30%, Evening 15%, Night 15%) —
 *     no endpoint returns an hour-of-day traffic distribution.
 *   - the "Last 30 Days" date selector and "Export" button — neither wired to anything, and
 *     no endpoint honours a date range.
 * What replaces them is smaller and true: the real point-in-time counts the backend actually
 * computes, presented as StatCards grouped into SectionCards by operational area.
 *
 * The data source is the same one the dashboard and /reports page use. The difference is
 * framing: this page sits under Settings and presents the figures as a platform snapshot
 * rather than an attention grid.
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

interface AnalyticsSection {
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

export default function AnalyticsPage() {
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

  const sections = useMemo<AnalyticsSection[]>(() => {
    const built: AnalyticsSection[] = [];

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
      <TopBar breadcrumbs={[{ label: 'Settings' }, { label: 'Analytics' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Platform Analytics"
            subtitle="Database-counted figures for your organization. Only what your role permits — no trends, distributions or time-series, because the backend exposes none."
          />

          <ResourceState
            isLoading={metrics.isLoading}
            error={metrics.error}
            isEmpty={!metrics.isLoading && !metrics.error && !hasContent}
            onRetry={metrics.reload}
            loadingLabel="Loading platform analytics…"
            forbiddenTitle="You cannot view platform analytics"
            errorTitle="Could not load platform analytics"
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
