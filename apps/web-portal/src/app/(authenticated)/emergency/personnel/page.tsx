'use client';

/**
 * Emergency personnel, wired to GET /organizations/{organization_id}/memberships.
 *
 * This page follows the same pattern as Settings → Members & access: the organization is
 * taken from the caller's active membership, the list is ordered by authority held, and
 * members are shown by identifier because no endpoint resolves a profile name.
 *
 * WHAT THIS PAGE CANNOT SHOW. `MembershipAdministrationView` carries role, status,
 * verification_status, site_ids and profile_id — but no name, no email, no phone, no
 * shift schedule and no certifications. The mock carried all of those as hardcoded
 * literals. They are removed rather than approximated, because inventing them would
 * misrepresent what the server knows. The role filter lets an operator narrow to the
 * roles relevant to emergency response (emergency, doctor, driver, admin).
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  PRIVILEGED_ROLES,
  ROLE_STYLE,
  STATUS_STYLE,
  VERIFICATION_AWAITING_ACTION,
  VERIFICATION_STYLE,
  formatInstant,
  humaniseCode,
  listMemberships,
  shortId,
} from '@/lib/api/directory';
import TopBar from '@/components/layout/TopBar';

/** Privileged roles first: an emergency personnel page should show who holds authority. */
const ROLE_WEIGHT: Record<string, number> = {
  super_admin: 0,
  admin: 1,
  emergency: 2,
  doctor: 3,
  pharmacy: 4,
  driver: 5,
  patient: 6,
};

const ROLE_FILTERS: ReadonlyArray<{ key: 'all' | string; label: string }> = [
  { key: 'all', label: 'All roles' },
  { key: 'emergency', label: 'Emergency' },
  { key: 'doctor', label: 'Doctors' },
  { key: 'driver', label: 'Drivers' },
  { key: 'admin', label: 'Admin' },
];

export default function PersonnelManagementPage() {
  const { user, activeMembership, isLoading: isAuthLoading } = useAuth();
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const organizationId = activeMembership?.organization_id ?? null;

  const { data, isLoading, error, reload } = useApiResource(
    (signal) => {
      if (!organizationId) return Promise.resolve(null);
      return listMemberships(organizationId, signal);
    },
    [organizationId],
  );

  const memberships = useMemo(() => data?.data ?? [], [data]);

  const ordered = useMemo(() => {
    const filtered =
      roleFilter === 'all' ? memberships : memberships.filter((row) => row.role === roleFilter);
    return [...filtered].sort((left, right) => {
      const byRole = (ROLE_WEIGHT[left.role] ?? 99) - (ROLE_WEIGHT[right.role] ?? 99);
      if (byRole !== 0) return byRole;
      return left.created_at.localeCompare(right.created_at);
    });
  }, [memberships, roleFilter]);

  const roles = useMemo(
    () => [...new Set(memberships.map((row) => row.role))].sort(
      (left, right) => (ROLE_WEIGHT[left] ?? 99) - (ROLE_WEIGHT[right] ?? 99),
    ),
    [memberships],
  );

  const privileged = useMemo(
    () => memberships.filter((row) => PRIVILEGED_ROLES.some((role) => role === row.role)).length,
    [memberships],
  );
  const active = useMemo(
    () => memberships.filter((row) => row.status === 'active').length,
    [memberships],
  );
  const awaiting = useMemo(
    () =>
      memberships.filter((row) =>
        VERIFICATION_AWAITING_ACTION.some((status) => status === row.verification_status),
      ).length,
    [memberships],
  );
  const emergencyCount = useMemo(
    () => memberships.filter((row) => row.role === 'emergency').length,
    [memberships],
  );

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  if (!organizationId) {
    return (
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
        <TopBar breadcrumbs={[{ label: 'Emergency' }, { label: 'Personnel' }]} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <span className="material-symbols-outlined text-slate-300 text-5xl">badge</span>
            <h1 className="mt-3 text-lg font-bold text-slate-900">Select a role first</h1>
            <p className="mt-1 text-sm text-slate-500">
              Personnel are listed for the organization of your active role, so one has to be
              selected before this page can load.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Emergency' }, { label: 'Personnel' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Emergency Personnel
            </h1>
            <p className="text-slate-500 mt-1">
              Members of this organization by role, status and site coverage.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { icon: 'group', tint: 'text-blue-600', label: 'Members', value: String(memberships.length), note: 'In this organization' },
              { icon: 'emergency', tint: 'text-red-600', label: 'Emergency role', value: String(emergencyCount), note: 'Assigned to emergency ops' },
              { icon: 'check_circle', tint: 'text-green-600', label: 'Active', value: String(active), note: 'Currently enabled' },
              { icon: 'pending_actions', tint: 'text-amber-600', label: 'Awaiting review', value: String(awaiting), note: 'Verification pending' },
            ].map((card) => (
              <div key={card.label} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className={`material-symbols-outlined ${card.tint} text-2xl`}>{card.icon}</span>
                  <span className="text-xs font-bold text-slate-500">{card.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{isLoading ? '—' : card.value}</p>
                <p className="text-xs text-slate-500 mt-1">{card.note}</p>
              </div>
            ))}
          </div>

          {/*
            Stated rather than worked around. A reader who expects names must know they are
            absent by design of the current API, not missing through a loading failure.
          */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600" role="note">
            <span className="font-bold text-slate-900">Names are not shown.</span> The membership
            API returns roles, states and site links but no personal details, so members are
            identified here by profile identifier.
          </div>

          <div className="flex flex-wrap gap-2">
            {ROLE_FILTERS.map((option) => {
              const available = option.key === 'all' || roles.includes(option.key as never);
              if (!available) return null;
              return (
                <button
                  key={option.key}
                  onClick={() => setRoleFilter(option.key)}
                  className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                    roleFilter === option.key
                      ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={ordered.length === 0}
            onRetry={reload}
            loadingLabel="Loading personnel…"
            forbiddenTitle="You cannot view emergency personnel"
            errorTitle="Could not load personnel"
            emptyTitle={roleFilter === 'all' ? 'No members found' : `No ${humaniseCode(roleFilter)} members`}
            emptyBody="Members appear here once people are invited or apply."
            emptyIcon="badge"
          />

          {!isLoading && !error && ordered.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Organization members ordered by the authority each role holds
                </caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Member</th>
                    <th scope="col" className="px-5 py-3">Role</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Verification</th>
                    <th scope="col" className="px-5 py-3 text-right">Sites</th>
                    <th scope="col" className="px-5 py-3">Member since</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ordered.map((row) => {
                    const isPrivileged = PRIVILEGED_ROLES.some((role) => role === row.role);
                    return (
                      <tr
                        key={row.id}
                        className={`hover:bg-slate-50 transition-colors ${
                          isPrivileged ? 'bg-purple-50/20' : ''
                        }`}
                      >
                        <td className="px-5 py-3">
                          <span className="font-bold text-slate-900">
                            <code>{shortId(row.profile_id)}</code>
                          </span>
                          <span className="block text-xs text-slate-400">
                            membership <code>{shortId(row.id)}</code>
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              ROLE_STYLE[row.role as keyof typeof ROLE_STYLE] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                            }`}
                          >
                            {humaniseCode(row.role)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              STATUS_STYLE[row.status as keyof typeof STATUS_STYLE] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                            }`}
                          >
                            {humaniseCode(row.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {/* Null is "not applicable to this role", not "unverified". */}
                          {row.verification_status === null ? (
                            <span className="text-slate-400 text-xs">Not applicable</span>
                          ) : (
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                                VERIFICATION_STYLE[row.verification_status as keyof typeof VERIFICATION_STYLE] ??
                                'bg-slate-50 text-slate-700 border-slate-100'
                              }`}
                            >
                              {humaniseCode(row.verification_status)}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {row.site_ids.length === 0 ? (
                            // A site-scoped role without a site holds no site authority at all.
                            <span className="text-amber-700 text-xs font-bold">No site</span>
                          ) : (
                            <span className="text-slate-700 font-bold">{row.site_ids.length}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-500">{formatInstant(row.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && !error && ordered.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{ordered.length}</span> member
              {ordered.length === 1 ? '' : 's'}, most privileged first
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
