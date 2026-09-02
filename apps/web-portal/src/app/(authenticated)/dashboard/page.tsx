'use client';

/**
 * Admin Overview, wired to GET /admin/metrics.
 *
 * WHY THIS PAGE NEEDED A DEDICATED ENDPOINT RATHER THAN THE COLLECTIONS IT SUMMARISES. Every
 * list in this API is bounded at 100 rows, so counting the rows of a page would have printed
 * `100` as the total for any organization larger than that — wrong precisely when the number
 * starts to matter. Totals have to be counted by the database, so `GET /admin/metrics` was added
 * first.
 *
 * A MISSING GROUP IS NOT A ZERO. The server omits a group the caller cannot read, and this page
 * says so on screen instead of drawing a card with 0 in it. A zero would be a lie about the data
 * and indistinguishable from an empty organization; naming the refusal is more useful than
 * hiding it, because "you cannot see revenue" is actionable and a silent gap is not.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT FABRICATE. There is no period-over-period trend arrow on
 * any number here, because `GET /admin/metrics` returns a snapshot, not a series. The "next 24
 * hours" window is a rolling one, not a calendar day, because a calendar day needs a timezone
 * and an organization stores none. Revenue counts captured payments only, and the footnote
 * says so: pending payments are excluded because they may never arrive, and refunds because
 * that money was returned.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import { GROUP_LABEL, GROUP_PERMISSION, readAdminMetrics, type MetricGroup } from '@/lib/api/metrics';
import { formatSen, initials } from '@/lib/api/directory';
import TopBar from '@/components/layout/TopBar';
import { cn } from '@/lib/utils';

const ALL_GROUPS: readonly MetricGroup[] = [
  'appointments',
  'emergencies',
  'support',
  'doctors',
  'revenue',
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatTodayDate(): string {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface MetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly icon: string;
  readonly tint: string;
  readonly href?: string;
  readonly alert?: boolean;
  readonly large?: boolean;
  readonly action?: React.ReactNode;
}

function MetricCard({ label, value, note, icon, tint, href, alert, large, action }: MetricCardProps) {
  const router = useRouter();
  const interactive = !!href;
  const onClick = () => {
    if (href) router.push(href);
  };
  return (
    <div
      onClick={interactive ? onClick : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'group relative bg-white rounded-2xl border shadow-sm p-6 transition-all',
        alert ? 'border-red-200' : 'border-slate-200',
        interactive && 'hover:shadow-md hover:border-blue-200 cursor-pointer',
      )}
    >
      <div className="flex items-start justify-between mb-5">
        <span className={cn('material-symbols-outlined text-2xl p-3 rounded-xl', tint)}>{icon}</span>
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={cn(
          'font-extrabold text-slate-900 tracking-tight',
          large ? 'text-5xl' : 'text-3xl',
          alert && 'text-red-600',
        )}
      >
        {value}
      </p>
      <p className={cn('text-xs mt-1', alert ? 'text-red-500' : 'text-slate-500')}>{note}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, profile, isLoading: isAuthLoading } = useAuth();

  const metrics = useApiResource((signal) => readAdminMetrics(signal), []);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  useEffect(() => {
    if (metrics.data) setLastUpdated(new Date());
  }, [metrics.data]);

  const data = metrics.data?.data;
  const readable = useMemo(
    () => new Set(metrics.data?.readable_groups ?? []),
    [metrics.data],
  );
  const withheld = useMemo(() => ALL_GROUPS.filter((group) => !readable.has(group)), [readable]);

  const displayName = profile?.display_name ?? user?.name ?? 'Admin';

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Dashboard' }, { label: 'Overview' }]} />

      <div className="flex-1 overflow-y-auto p-6 lg:p-8 scroll-smooth">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
          {/* Greeting hero */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e3fae] to-[#0f2470] p-6 sm:p-8 shadow-lg text-white">
            <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div>
                <p className="text-blue-100 font-medium">{greeting()},</p>
                <h1 className="text-2xl sm:text-3xl font-extrabold mt-1 tracking-tight">{displayName}</h1>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-100 bg-white/10 px-2.5 py-1 rounded-full">
                    <span className="material-symbols-outlined text-sm">shield_person</span>
                    Administrator
                  </span>
                  <span className="text-blue-200 text-sm">{formatTodayDate()}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right hidden sm:block">
                  <p className="text-xs text-blue-200">Last refreshed</p>
                  <p className="text-sm font-bold mt-0.5">
                    {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </p>
                </div>
                <button
                  onClick={() => metrics.reload()}
                  aria-label="Refresh metrics"
                  className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <span className="material-symbols-outlined">refresh</span>
                </button>
                <div className="size-12 rounded-full bg-white/20 border-2 border-white/30 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                  {initials(displayName)}
                </div>
              </div>
            </div>
          </div>

          <ResourceState
            isLoading={metrics.isLoading}
            error={metrics.error}
            isEmpty={!metrics.isLoading && !metrics.error && !data}
            onRetry={metrics.reload}
            loadingLabel="Loading dashboard figures…"
            forbiddenTitle="You cannot view dashboard figures"
            errorTitle="Could not load dashboard figures"
            emptyTitle="No figures available for your role"
            emptyBody="Your role does not permit any of the summarised areas."
            emptyIcon="query_stats"
          />

          {data && (
            <>
              {/* KPI bento grid */}
              <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-4">
                {readable.has('appointments') && data.appointments && (
                  <div className="xl:col-span-3">
                    <MetricCard
                      label="Appointments"
                      value={data.appointments.total.toLocaleString('en-MY')}
                      note="All time, counted by the database"
                      icon="event"
                      tint="bg-blue-50 text-blue-600"
                      href="/appointments"
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Next 24h</p>
                        <p className="text-lg font-extrabold text-slate-900 mt-1">
                          {data.appointments.starting_within_24h.toLocaleString('en-MY')}
                        </p>
                      </div>
                      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Live</p>
                        <p className="text-lg font-extrabold text-amber-600 mt-1">
                          {data.appointments.active.toLocaleString('en-MY')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {readable.has('doctors') && data.doctors && (
                  <div className="xl:col-span-3">
                    <MetricCard
                      label="Doctors listed"
                      value={data.doctors.listed.toLocaleString('en-MY')}
                      note={`${data.doctors.accepting_new_patients} accepting new patients`}
                      icon="stethoscope"
                      tint="bg-emerald-50 text-emerald-600"
                      href="/users/doctors"
                    />
                  </div>
                )}

                {readable.has('support') && data.support && (
                  <div className="xl:col-span-3">
                    <MetricCard
                      label="Open tickets"
                      value={data.support.open.toLocaleString('en-MY')}
                      note="Not resolved or closed"
                      icon="confirmation_number"
                      tint="bg-cyan-50 text-cyan-600"
                      href="/support/tickets"
                    />
                  </div>
                )}

                {readable.has('emergencies') && data.emergencies && (
                  <div className="xl:col-span-3">
                    <MetricCard
                      label="Active emergencies"
                      value={data.emergencies.active.toLocaleString('en-MY')}
                      note="Awaiting resolution"
                      icon="emergency"
                      tint="bg-red-50 text-red-600"
                      href="/emergency"
                      alert={data.emergencies.active > 0}
                    />
                  </div>
                )}

                {readable.has('revenue') && data.revenue && (
                  <div className="xl:col-span-8">
                    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 p-6 sm:p-8 text-white shadow-lg h-full flex flex-col justify-between">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-emerald-100 text-xs font-bold uppercase tracking-wide">Revenue</p>
                          <p className="text-5xl sm:text-6xl font-extrabold mt-3 tracking-tight">
                            {formatSen(data.revenue.captured_sen, data.revenue.currency)}
                          </p>
                          <p className="text-emerald-100 text-sm mt-2">Captured this month, from {formatTime(data.revenue.period_start)}</p>
                        </div>
                        <span className="material-symbols-outlined text-5xl text-white/20">payments</span>
                      </div>
                      <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
                        <p className="text-xs text-emerald-100 max-w-md">
                          Captured payments only. Pending payments are excluded because they may never arrive, and refunds because that money was returned.
                        </p>
                        <button
                          onClick={() => router.push('/finance')}
                          className="bg-white text-emerald-800 font-extrabold text-sm py-2.5 px-5 rounded-xl hover:bg-emerald-50 transition-colors flex items-center gap-2"
                        >
                          View finance
                          <span className="material-symbols-outlined text-base">arrow_forward</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {readable.has('support') && data.support && (
                  <div className="xl:col-span-4">
                    <MetricCard
                      label="Past due"
                      value={data.support.breaching_resolution.toLocaleString('en-MY')}
                      note="Beyond the resolution deadline"
                      icon="running_with_errors"
                      tint="bg-orange-50 text-orange-600"
                      href="/support/tickets"
                      alert={data.support.breaching_resolution > 0}
                    />
                  </div>
                )}
              </section>

              {/* Quick actions */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">Quick actions</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'Medical staff', icon: 'stethoscope', tint: 'bg-blue-50 text-blue-600', href: '/users/doctors' },
                    { label: 'Patients', icon: 'groups', tint: 'bg-teal-50 text-teal-600', href: '/users/patients' },
                    { label: 'Devices', icon: 'devices', tint: 'bg-indigo-50 text-indigo-600', href: '/devices' },
                    { label: 'Reports', icon: 'monitoring', tint: 'bg-purple-50 text-purple-600', href: '/reports' },
                  ].map((action) => (
                    <button
                      key={action.label}
                      onClick={() => router.push(action.href)}
                      className="group flex items-center gap-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-blue-200 transition-all text-left"
                    >
                      <span className={cn('material-symbols-outlined text-2xl p-3 rounded-xl', action.tint)}>
                        {action.icon}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-slate-900 group-hover:text-[#1e3fae] transition-colors">
                          {action.label}
                        </p>
                        <p className="text-xs text-slate-500">Open</p>
                      </div>
                      <span className="material-symbols-outlined text-slate-300 group-hover:text-[#1e3fae] transition-colors">
                        chevron_right
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Withheld groups */}
              {withheld.length > 0 && (
                <section
                  className="rounded-2xl border border-slate-200 bg-white p-6"
                  aria-live="polite"
                >
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-slate-400 mt-0.5">lock</span>
                    <div className="flex-1">
                      <h2 className="font-bold text-slate-900 text-sm">Not shown for your role</h2>
                      <p className="text-xs text-slate-500 mt-1">
                        These areas are withheld rather than shown as zero, so a blank figure is never mistaken for an empty one.
                      </p>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {withheld.map((group) => (
                          <li
                            key={group}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600"
                          >
                            <span className="font-bold">{GROUP_LABEL[group]}</span>
                            <code className="text-slate-400">{GROUP_PERMISSION[group]}</code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
