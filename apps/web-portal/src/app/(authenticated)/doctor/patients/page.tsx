'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import StatCard from '@/components/ui/stat-card';
import SearchInput from '@/components/ui/search-input';
import Badge from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';
import { listDoctorPatients } from '@/lib/api/doctor-patients';
import type { DoctorAssignedPatient } from '@/lib/api/doctor-patients';
import { formatInstant, humaniseCode, initials, shortId } from '@/lib/api/directory';

/**
 * Map a doctor-patient assignment status to a Badge tone.
 *
 * The assignment status is a string from the server; we map the known values to
 * semantic colours and fall back to slate for anything unexpected. This is a
 * display concern only — the value itself is never retyped.
 */
function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'active':
      return 'green';
    case 'pending':
    case 'invited':
    case 'applied':
      return 'amber';
    case 'suspended':
      return 'orange';
    case 'revoked':
    case 'expired':
      return 'slate';
    default:
      return 'slate';
  }
}

/**
 * Build a display label for a patient when the API has not resolved a name.
 *
 * The doctor-patients endpoint is one of the few that carries another person's
 * `display_name`, so it is usually present. When it is empty we show the short
 * identifier rather than inventing a name.
 */
function patientLabel(patient: DoctorAssignedPatient): string {
  return patient.display_name.trim().length > 0
    ? patient.display_name
    : `Patient ${shortId(patient.profile_id)}`;
}

export default function MyPatients() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [search, setSearch] = useState('');

  const resource = useApiResource(
    (signal) => listDoctorPatients({ search: search.trim() || undefined, pageSize: 100, signal }),
    [search],
  );

  const patients = useMemo(() => resource.data?.data ?? [], [resource.data]);

  // KPIs are derived from the loaded page, not from a separate endpoint, so
  // they reflect exactly what the doctor can see in this view.
  const kpis = useMemo(() => {
    const total = patients.length;
    const active = patients.filter((p) => p.status === 'active').length;
    const pending = patients.filter((p) =>
      ['pending', 'invited', 'applied'].includes(p.status),
    ).length;
    const withPhone = patients.filter((p) => p.phone_e164).length;
    return { total, active, pending, withPhone };
  }, [patients]);

  if (authLoading || !user) return <PageLoader label="Loading..." />;
  if (user.activeRole !== 'doctor') return null;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Patients' }]} />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          <PageHeader
            title="My Patients"
            subtitle="Patients assigned to your active doctor membership."
          />

          {/* KPI row — derived from the loaded page */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon="groups"
              label="Total"
              value={kpis.total}
              note="Assigned patients"
              tone="blue"
            />
            <StatCard
              icon="person_check"
              label="Active"
              value={kpis.active}
              note="Currently active"
              tone="green"
            />
            <StatCard
              icon="hourglass_top"
              label="Pending"
              value={kpis.pending}
              note="Awaiting activation"
              tone="amber"
            />
            <StatCard
              icon="phone"
              label="With phone"
              value={kpis.withPhone}
              note="Contactable by call"
              tone="teal"
            />
          </div>

          {/* Search */}
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search patients by name or email..."
            className="max-w-md"
          />

          <ResourceState
            isLoading={resource.isLoading}
            error={resource.error}
            isEmpty={!resource.isLoading && !resource.error && patients.length === 0}
            onRetry={resource.reload}
            loadingLabel="Loading patients..."
            errorTitle="Could not load patients"
            forbiddenTitle="You cannot view assigned patients"
            emptyTitle="No assigned patients"
            emptyBody="No patients matched your search or assignment scope."
            emptyIcon="groups"
          />

          {/* Patient card grid */}
          {!resource.isLoading && !resource.error && patients.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {patients.map((patient) => {
                const label = patientLabel(patient);
                const avatarText =
                  patient.display_name.trim().length > 0
                    ? initials(patient.display_name)
                    : shortId(patient.profile_id).slice(0, 2).toUpperCase();
                return (
                  <button
                    key={patient.profile_id}
                    type="button"
                    onClick={() => router.push(`/doctor/patients/${patient.profile_id}`)}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer text-left flex flex-col gap-4 focus:outline-none focus:ring-2 focus:ring-[#1e3fae]/20"
                  >
                    {/* Header: avatar + name + status */}
                    <div className="flex items-start gap-4">
                      <div className="size-12 rounded-full bg-[#1e3fae]/10 text-[#1e3fae] flex items-center justify-center font-bold text-base shrink-0">
                        {avatarText}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-slate-900 truncate">{label}</h3>
                          <Badge tone={statusTone(patient.status)}>
                            {humaniseCode(patient.status)}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-500 truncate mt-0.5">
                          {patient.email}
                        </p>
                      </div>
                    </div>

                    {/* Secondary info */}
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
                      {patient.phone_e164 && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-slate-400 text-[18px]">
                            call
                          </span>
                          {patient.phone_e164}
                        </span>
                      )}
                      {patient.preferred_locale && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-slate-400 text-[18px]">
                            translate
                          </span>
                          {patient.preferred_locale}
                        </span>
                      )}
                      {patient.timezone && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-slate-400 text-[18px]">
                            schedule
                          </span>
                          {patient.timezone}
                        </span>
                      )}
                    </div>

                    {/* Footer: assigned date + short id */}
                    <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                      <span className="text-xs text-slate-400">
                        Assigned {formatInstant(patient.assigned_at)}
                      </span>
                      <code className="text-xs text-slate-400">
                        {shortId(patient.profile_id)}
                      </code>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
