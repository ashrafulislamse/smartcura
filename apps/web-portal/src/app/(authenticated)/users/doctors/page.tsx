'use client';

/**
 * Doctor directory, wired to GET /doctors.
 *
 * THIS ENDPOINT ONLY RETURNS APPROVED, ACTIVE DOCTORS, and that is a deliberate property
 * rather than a filter this page applies: an unapproved doctor is concealed by the query, so
 * there is no client-side state in which one could be shown. A page that expected to
 * administer pending doctors is looking at the wrong surface — the verification queue is
 * separate and has no endpoint yet.
 *
 * RECONCILIATION. The mock carried patient counts, revenue and a joined date. None is
 * modelled here: this is a discovery directory, so it carries what a patient choosing a
 * doctor needs — fee, rating, review count, specialties, languages, next availability.
 * Those invented figures are removed rather than approximated.
 *
 * `rating_average` is null until reviews exist. Rendering null as 0.0 would make a new
 * doctor look badly rated rather than unrated, so the two are shown differently.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  formatInstant,
  formatSen,
  humaniseCode,
  initials,
  listDoctors,
  type DoctorSort,
} from '@/lib/api/directory';
import TopBar from '@/components/layout/TopBar';

const SORTS: ReadonlyArray<{ key: DoctorSort; label: string }> = [
  { key: 'soonest', label: 'Soonest available' },
  { key: 'rating', label: 'Highest rated' },
  { key: 'fee', label: 'Lowest fee' },
];

export default function DoctorsDirectoryPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [sort, setSort] = useState<DoctorSort>('soonest');
  const [acceptingOnly, setAcceptingOnly] = useState(false);

  const { data, isLoading, error, reload } = useApiResource(
    (signal) =>
      listDoctors({
        q: applied.trim() === '' ? undefined : applied.trim(),
        sort,
        acceptsNewPatients: acceptingOnly ? true : undefined,
        signal,
      }),
    [applied, sort, acceptingOnly],
  );

  const doctors = useMemo(() => data?.data ?? [], [data]);
  const hasMore = data?.page?.has_more ?? false;

  const accepting = useMemo(
    () => doctors.filter((doctor) => doctor.accepts_new_patients).length,
    [doctors],
  );
  // Keyed on review_count for the same reason as the row: the derived average is coalesced
  // to 0, so an unrated doctor is indistinguishable from a badly rated one by rating alone.
  const unrated = useMemo(
    () => doctors.filter((doctor) => doctor.review_count === 0).length,
    [doctors],
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
      <TopBar breadcrumbs={[{ label: 'Users' }, { label: 'Doctors' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Doctors</h1>
            <p className="text-slate-500 mt-1">
              Approved, active doctors only. Pending verifications are handled separately.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'stethoscope', tint: 'text-blue-600', label: 'Listed', value: String(doctors.length), note: 'Approved and active' },
              { icon: 'person_add', tint: 'text-green-600', label: 'Accepting', value: String(accepting), note: 'Open to new patients' },
              { icon: 'star_half', tint: 'text-slate-600', label: 'Unrated', value: String(unrated), note: 'No reviews yet' },
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

          <form
            onSubmit={(event) => {
              event.preventDefault();
              // The server searches, not the browser: it holds the full set and this page
              // only ever has one page of it.
              setApplied(search);
            }}
            className="flex flex-col md:flex-row gap-3"
          >
            <div className="relative flex-1 group">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1e3fae] transition-colors">
                <span className="material-symbols-outlined">search</span>
              </span>
              <input
                className="w-full bg-white text-sm text-slate-900 rounded-lg border border-slate-200 pl-10 pr-4 py-3 placeholder-slate-400 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all shadow-sm"
                placeholder="Search by name, practice or specialty..."
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button
              type="submit"
              className="px-5 py-3 bg-[#1e3fae] text-white rounded-lg font-bold text-sm shadow-md hover:bg-blue-700"
            >
              Search
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            {SORTS.map((option) => (
              <button
                key={option.key}
                onClick={() => setSort(option.key)}
                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  sort === option.key
                    ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-sm font-bold text-slate-600">
              <input
                type="checkbox"
                checked={acceptingOnly}
                onChange={(event) => setAcceptingOnly(event.target.checked)}
                className="rounded border-slate-300"
              />
              Accepting new patients
            </label>
          </div>

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={doctors.length === 0}
            onRetry={reload}
            loadingLabel="Loading the doctor directory…"
            forbiddenTitle="You cannot view the doctor directory"
            errorTitle="Could not load the doctor directory"
            emptyTitle={applied === '' ? 'No approved doctors yet' : 'No doctors match that search'}
            emptyBody={
              applied === ''
                ? 'Doctors appear here once their verification is approved.'
                : 'Try a different name, practice or specialty.'
            }
            emptyIcon="stethoscope"
          />

          {!isLoading && !error && doctors.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {doctors.map((doctor) => (
                <button
                  key={doctor.membership_id}
                  onClick={() => router.push(`/users/doctors/${doctor.membership_id}`)}
                  className="text-left bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-full bg-[#1e3fae]/10 text-[#1e3fae] flex items-center justify-center font-bold shrink-0">
                      {initials(doctor.display_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-bold text-slate-900 truncate">{doctor.display_name}</h2>
                        {doctor.verified && (
                          <span className="material-symbols-outlined text-blue-600 text-[18px]" title="Verified">
                            verified
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">
                        {doctor.primary_specialty ? humaniseCode(doctor.primary_specialty) : 'Specialty not stated'}
                        {doctor.practice_name ? ` · ${doctor.practice_name}` : ''}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
                        <span className="font-bold text-slate-900">
                          {formatSen(doctor.consultation_fee_sen, doctor.currency)}
                        </span>
                        <span className="text-slate-300">|</span>
                        {/*
                          UNRATED IS KEYED ON review_count, NOT ON A NULL RATING. The server
                          coalesces the derived average to 0 when there are no reviews, so a
                          null check would classify every new doctor as rated 0.0 — which
                          displays as the worst possible score rather than as no score. The
                          review count is the only field that distinguishes them.
                        */}
                        {doctor.review_count === 0 ? (
                          <span className="text-slate-400">Not yet rated</span>
                        ) : (
                          <span className="text-slate-600">
                            {(doctor.rating_average ?? 0).toFixed(1)} ({doctor.review_count} review
                            {doctor.review_count === 1 ? '' : 's'})
                          </span>
                        )}
                        {doctor.years_experience !== null && (
                          <>
                            <span className="text-slate-300">|</span>
                            <span className="text-slate-600">{doctor.years_experience}y experience</span>
                          </>
                        )}
                      </div>

                      {doctor.languages.length > 0 && (
                        <p className="text-xs text-slate-500 mt-2">
                          Speaks {doctor.languages.map(humaniseCode).join(', ')}
                        </p>
                      )}

                      <div className="flex items-center gap-2 mt-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                            doctor.accepts_new_patients
                              ? 'bg-green-50 text-green-700 border-green-100'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {doctor.accepts_new_patients ? 'Accepting patients' : 'Not accepting'}
                        </span>
                        <span className="text-xs text-slate-400">
                          {doctor.next_available_at
                            ? `next ${formatInstant(doctor.next_available_at)}`
                            : 'no published availability'}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!isLoading && !error && doctors.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{doctors.length}</span> doctor
              {doctors.length === 1 ? '' : 's'}
              {hasMore && ' — more available; narrow the search to see them'}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
