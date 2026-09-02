'use client';

/**
 * Approved doctor profile, wired to GET /doctors/{membership_id}.
 *
 * RECONCILIATION WITH THE PREVIOUS MOCK. The mock carried an education, a license number,
 * an email, per-specialty skill gauges, consultations, earnings, availability, a shift
 * status and fabricated reviews. None of that is on the directory read-one endpoint: it
 * returns the same approved, active directory item a discovery search does (fee, rating,
 * review count, specialties, languages, next availability), plus no name but
 * `display_name` and `practice_name`. Education, license, consultations and earnings are
 * REMOVED rather than approximated — the directory is a discovery surface, and
 * professional credentials live on doctor-details and verification, which are separate
 * surfaces this endpoint does not join.
 *
 * THIS PAGE ONLY EVER SHOWS APPROVED DOCTORS. The endpoint conceals anyone whose
 * verification is not approved, so there is no client-side state in which a pending doctor
 * could be rendered. Administering pending doctors is the verification queue's job, not
 * this page's.
 *
 * `rating_average` arrives as 0 for a doctor with no reviews, so only `review_count`
 * distinguishes unrated from badly rated; the two are rendered differently.
 */

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  formatSen,
  formatInstant,
  getDoctor,
  humaniseCode,
  initials,
  listDoctorReviews,
} from '@/lib/api/directory';
import TopBar from '@/components/layout/TopBar';
import type { DoctorReviewTag, UnknownEnumValue } from '@/types/contracts';

/** The known members of an enum, excluding the forward-compatibility escape hatch. */
type Known<T> = Exclude<T, UnknownEnumValue>;

const REVIEW_TAG_LABELS: Record<Known<DoctorReviewTag>, string> = {
  good_listener: 'Good listener',
  on_time: 'On time',
  clear_explanation: 'Clear explanation',
  professional: 'Professional',
  helpful: 'Helpful',
};

function tagLabel(tag: string): string {
  return REVIEW_TAG_LABELS[tag as Known<DoctorReviewTag>] ?? humaniseCode(tag);
}

export default function DoctorDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const membershipId = String(params.id);

  const doctor = useApiResource(
    (signal) => getDoctor(membershipId, signal),
    [membershipId],
  );

  // Reviews: the read-one directory item carries a `reviews_preview`, but the
  // full list is a separate endpoint. Fetch it alongside the profile so the
  // page shows every review rather than only the preview slice.
  const reviews = useApiResource(
    (signal) => listDoctorReviews(membershipId, { pageSize: 100, signal }),
    [membershipId],
  );
  const reviewRows = useMemo(() => reviews.data?.data ?? [], [reviews.data]);

  const notFound = doctor.error?.status === 404;

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  const record = doctor.data;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Users', href: '/users/doctors' },
          { label: 'Doctors', href: '/users/doctors' },
          { label: record?.display_name ?? `#${membershipId.slice(0, 8)}` },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1000px] mx-auto flex flex-col gap-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-[#1e3fae] transition-colors self-start"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to doctors
          </button>

          {notFound ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">stethoscope</span>
              <h2 className="font-bold text-slate-900 mt-3">Doctor not found</h2>
              <p className="text-sm text-slate-500 mt-1">
                This doctor is not currently in the approved directory, or you cannot view it.
              </p>
              <button
                onClick={() => router.push('/users/doctors')}
                className="inline-block mt-4 text-sm font-bold text-[#1e3fae] hover:underline"
              >
                Back to doctors
              </button>
            </div>
          ) : (
            <ResourceState
              isLoading={doctor.isLoading}
              error={doctor.error}
              isEmpty={false}
              onRetry={doctor.reload}
              loadingLabel="Loading doctor profile…"
              forbiddenTitle="You cannot view this doctor"
              errorTitle="Could not load the doctor"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}

          {record && !doctor.error && (
            <div className="flex flex-col gap-6">
              {/* Header */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
                <div className="flex flex-col md:flex-row md:items-start gap-6">
                  <div className="h-20 w-20 rounded-2xl bg-[#1e3fae]/10 text-[#1e3fae] flex items-center justify-center text-2xl font-extrabold shrink-0">
                    {initials(record.display_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                        {record.display_name}
                      </h1>
                      {record.verified && (
                        <span
                          className="material-symbols-outlined text-blue-600 text-[22px]"
                          title="Verified"
                        >
                          verified
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 mt-1">
                      {record.primary_specialty
                        ? humaniseCode(record.primary_specialty)
                        : 'Specialty not stated'}
                      {record.practice_name ? ` · ${record.practice_name}` : ''}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 mt-4 text-sm">
                      <span className="font-bold text-slate-900">
                        {formatSen(record.consultation_fee_sen, record.currency)}
                      </span>
                      {record.years_experience !== null && (
                        <>
                          <span className="text-slate-300">|</span>
                          <span className="text-slate-600">{record.years_experience}y experience</span>
                        </>
                      )}
                      <span className="text-slate-300">|</span>
                      {record.review_count === 0 ? (
                        <span className="text-slate-400">Not yet rated</span>
                      ) : (
                        <span className="text-slate-600">
                          {(record.rating_average ?? 0).toFixed(1)} ({record.review_count} review
                          {record.review_count === 1 ? '' : 's'})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status + next availability */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Accepting new patients
                    </p>
                    <span
                      className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold border ${
                        record.accepts_new_patients
                          ? 'bg-green-50 text-green-700 border-green-100'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {record.accepts_new_patients ? 'Accepting patients' : 'Not accepting'}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Next availability
                    </p>
                    <p className="text-sm font-semibold text-slate-700">
                      {record.next_available_at
                        ? new Date(record.next_available_at).toLocaleString()
                        : 'No published availability'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Biography */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
                  Biography
                </h2>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {record.biography ?? 'No biography has been published.'}
                </p>
              </div>

              {/* Specialties & languages */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
                    Specialties
                  </h2>
                  {record.specialties.length === 0 ? (
                    <p className="text-sm text-slate-500">None stated.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {record.specialties.map((specialty) => (
                        <span
                          key={specialty}
                          className="px-2.5 py-1 bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 rounded"
                        >
                          {humaniseCode(specialty)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
                    Languages
                  </h2>
                  {record.languages.length === 0 ? (
                    <p className="text-sm text-slate-500">None stated.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {record.languages.map((language) => (
                        <span
                          key={language}
                          className="px-2.5 py-1 bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 rounded"
                        >
                          {humaniseCode(language)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Reviews */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                    Reviews
                  </h2>
                  <span className="text-sm text-slate-500">
                    {record.review_count === 0
                      ? 'Not yet rated'
                      : `${record.review_count} review${record.review_count === 1 ? '' : 's'}`}
                  </span>
                </div>

                {reviews.isLoading ? (
                  <div className="flex items-center gap-3 py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#1e3fae]"></div>
                    <p className="text-sm text-slate-500">Loading reviews…</p>
                  </div>
                ) : reviews.error ? (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4"
                    role="alert"
                  >
                    <p className="text-sm font-bold text-red-700">
                      Could not load reviews
                    </p>
                    <p className="text-xs text-red-600 mt-1">{reviews.error.message}</p>
                  </div>
                ) : reviewRows.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4 text-center">
                    No reviews have been submitted yet.
                  </p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {reviewRows.map((review) => (
                      <div
                        key={review.id}
                        className="rounded-lg border border-slate-200 p-4"
                      >
                        <div className="flex items-center gap-3 flex-wrap mb-2">
                          <div className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-amber-500 text-[18px]">
                              star
                            </span>
                            <span className="font-bold text-slate-900 text-sm">
                              {review.rating}
                            </span>
                            <span className="text-xs text-slate-400">/ 5</span>
                          </div>
                          {review.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {review.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="px-2 py-0.5 bg-blue-50 border border-blue-100 text-xs font-semibold text-blue-700 rounded"
                                >
                                  {tagLabel(tag)}
                                </span>
                              ))}
                            </div>
                          )}
                          <span className="text-xs text-slate-400 ml-auto">
                            {formatInstant(review.created_at)}
                          </span>
                        </div>
                        {review.comment && (
                          <p className="text-sm text-slate-700 leading-relaxed">
                            {review.comment}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
