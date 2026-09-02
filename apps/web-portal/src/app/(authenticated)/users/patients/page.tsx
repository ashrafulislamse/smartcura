'use client';

/**
 * Patient directory, wired to GET /organizations/{id}/patients.
 *
 * RECONCILIATION WITH THE PREVIOUS MOCK. `mockPatients` carried
 * `department`, `doctor`, `admissionDate`, `gender`, `age`, `bloodGroup`,
 * `address`, `location`, `allergies`, `totalVisits`, `lastVisit` and
 * `nextAppointment` — none of which the directory endpoint returns. The
 * endpoint joins `profiles` to resolve `display_name`, `email` and
 * `phone_e164`, and carries the membership's `status` and `joined_at`.
 * Those invented clinical fields are removed rather than approximated,
 * because a fabricated allergy or blood type in a patient directory is
 * worse than their absence.
 *
 * STATUS BADGES use `PROFILE_STATUS_STYLE` (exhaustive over the generated
 * `ProfileStatus` enum) so `active` is visually distinct from `suspended`.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import { PROFILE_STATUS_STYLE, humaniseCode, shortId } from '@/lib/api/directory';
import { listOrganizationPatients } from '@/lib/api/workstream-f';

export default function PatientsPage() {
  const { activeMembership, isLoading: authLoading } = useAuth();
  const organizationId = activeMembership?.organization_id;
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');

  const { data, isLoading, error, reload } = useApiResource(
    (signal) =>
      organizationId
        ? listOrganizationPatients(organizationId, {
            search: submittedSearch || undefined,
            limit: 100,
            signal,
          })
        : Promise.resolve(null),
    [organizationId, submittedSearch],
  );

  const patients = useMemo(() => data?.data ?? [], [data]);

  if (authLoading) return <div className="p-8 text-slate-500">Loading session...</div>;

  if (!organizationId)
    return (
      <main className="p-8">
        <ResourceState
          isLoading={false}
          error={null}
          isEmpty
          onRetry={reload}
          loadingLabel="Loading patients..."
          forbiddenTitle="Patients unavailable"
          errorTitle="Patients unavailable"
          emptyTitle="No active organization"
          emptyBody="Select an active membership before viewing patients."
          emptyIcon="groups"
        />
      </main>
    );

  return (
    <main className="flex-1 min-h-screen bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Users' }, { label: 'Patients' }]} />
      <div className="p-5 sm:p-8 max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Patients</h1>
          <p className="text-slate-500 mt-1">
            Patient memberships reachable in your active organization.
          </p>
        </div>

        {/* Search form */}
        <form
          className="bg-white border border-slate-200 rounded-2xl p-4 flex gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedSearch(search.trim());
          }}
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="flex-1 h-11 px-4 rounded-xl bg-slate-50 border border-slate-200"
            placeholder="Search by name or email"
          />
          <button className="px-5 rounded-xl bg-[#1e3fae] text-white font-bold">Search</button>
        </form>

        <ResourceState
          isLoading={isLoading}
          error={error}
          isEmpty={!patients.length}
          onRetry={reload}
          loadingLabel="Loading patients..."
          forbiddenTitle="You cannot view patients"
          errorTitle="Patients could not be loaded"
          emptyTitle="No patients found"
          emptyBody="No patient memberships match this organization or search."
          emptyIcon="groups"
        />

        {!isLoading && !error && patients.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-4">Patient</th>
                  <th className="p-4">Contact</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Joined</th>
                  <th className="p-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {patients.map((patient) => (
                  <tr key={patient.profile_id} className="hover:bg-blue-50/40">
                    <td className="p-4">
                      <div className="font-bold text-slate-900">{patient.display_name}</div>
                      <code className="text-xs text-slate-400">{shortId(patient.profile_id)}</code>
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      {patient.email}
                      <br />
                      {patient.phone_e164 ?? 'No phone recorded'}
                    </td>
                    <td className="p-4">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-bold ${
                          PROFILE_STATUS_STYLE[
                            patient.status as keyof typeof PROFILE_STATUS_STYLE
                          ] ?? 'bg-slate-50 text-slate-600 border-slate-100'
                        }`}
                      >
                        {humaniseCode(patient.status)}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-500">
                      {new Date(patient.joined_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => router.push(`/users/patients/${patient.profile_id}`)}
                        className="text-[#1e3fae] font-bold text-sm"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
