'use client';

/**
 * Fleet management — wired to GET /emergency-units.
 *
 * The roster is scoped to the caller's organization (the server takes the org from the
 * membership, never from the request) and ordered by operational availability: `available`
 * units first, then active-deployment states, then `out_of_service` last, with call sign
 * as the tiebreaker. The list is rendered exactly as returned — no client re-sort.
 *
 * WHAT THE ROSTER DOES NOT CARRY, and why:
 * - NO CREW. `emergency_units` has no crew column; responder affiliation is a derived,
 *   time-windowed join through `responder_shifts` that is not surfaced here. Fabricating
 *   crew names or images would repeat the mock's exact mistake.
 * - NO LOCATION. Units do not carry coordinates. A unit's site is identified by `site_id`.
 * - NO EQUIPMENT STATUS. No such column exists.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import {
  UNIT_STATUS_STYLE,
  humaniseCode,
  listEmergencyUnits,
  shortId,
  type EmergencyUnitStatus,
} from '@/lib/api/emergency';

const STATUS_FILTERS: ReadonlyArray<{ key: 'all' | EmergencyUnitStatus; label: string }> = [
  { key: 'all', label: 'All units' },
  { key: 'available', label: 'Available' },
  { key: 'en_route', label: 'En route' },
  { key: 'on_scene', label: 'On scene' },
  { key: 'transporting', label: 'Transporting' },
  { key: 'reserved', label: 'Reserved' },
  { key: 'out_of_service', label: 'Out of service' },
];

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['en_route', 'on_scene', 'transporting']);

export default function FleetManagementPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [status, setStatus] = useState<'all' | EmergencyUnitStatus>('all');

  const { data, isLoading, error, reload } = useApiResource(
    (signal) =>
      listEmergencyUnits({
        status: status === 'all' ? undefined : status,
        limit: 100,
        signal,
      }),
    [status],
  );

  // Rendered in server order. No client sort.
  const units = useMemo(() => data?.data ?? [], [data]);

  const available = useMemo(
    () => units.filter((unit) => unit.status === 'available').length,
    [units],
  );
  const active = useMemo(
    () => units.filter((unit) => ACTIVE_STATUSES.has(unit.status)).length,
    [units],
  );
  const outOfService = useMemo(
    () => units.filter((unit) => unit.status === 'out_of_service').length,
    [units],
  );

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Emergency' }, { label: 'Fleet management' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                Fleet Management
              </h1>
              <p className="text-slate-500 mt-1">
                Emergency unit roster and availability.
              </p>
            </div>
            <button
              onClick={reload}
              className="px-4 py-2.5 border border-slate-200 bg-white rounded-lg font-bold text-sm text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'check_circle', tint: 'text-green-600', label: 'Available', value: String(available), note: 'Ready for dispatch' },
              { icon: 'local_shipping', tint: 'text-amber-600', label: 'Active', value: String(active), note: 'En route, on scene, or transporting' },
              { icon: 'build', tint: 'text-slate-500', label: 'Out of service', value: String(outOfService), note: 'Unavailable for dispatch' },
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

          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option.key}
                onClick={() => setStatus(option.key)}
                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  status === option.key
                    ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={units.length === 0}
            onRetry={reload}
            loadingLabel="Loading fleet…"
            forbiddenTitle="You cannot view the fleet"
            errorTitle="Could not load the fleet"
            emptyTitle="No units found"
            emptyBody="No emergency units match the current filter."
            emptyIcon="local_shipping"
          />

          {!isLoading && !error && units.length > 0 && (
            <div className="flex flex-col gap-3">
              {units.map((unit) => (
                <div
                  key={unit.emergency_unit_id}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1 min-w-[260px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg font-bold text-slate-900">
                          {unit.call_sign}
                        </span>
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                            UNIT_STATUS_STYLE[unit.status] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                          }`}
                        >
                          {humaniseCode(unit.status)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 mt-2">
                        {humaniseCode(unit.unit_type)} · capacity {unit.capacity}
                      </p>
                      <p className="text-xs text-slate-400 mt-2">
                        site {shortId(unit.site_id)}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-500">Version</p>
                      <p className="text-lg font-bold text-slate-900">{unit.version}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && !error && units.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{units.length}</span> unit
              {units.length === 1 ? '' : 's'}
              {units.length === 100 && ' (server limit reached; filter by status)'}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
