'use client';

/**
 * Doctor professional profile editor, wired to
 * GET/PUT /memberships/{membershipId}/doctor-details.
 *
 * The PUT is an UPSERT: it "Creates or replaces own professional detail", so the same
 * `updateDoctorDetails` call serves both the first-time create (the resource 404s on
 * first load) and every subsequent edit. For a brand-new detail there is no existing
 * version to guard against, so `version: 0` is sent as the expected-version sentinel;
 * once the row exists, the loaded `version` is sent so a concurrent edit surfaces as a
 * 409 and the page re-reads instead of silently overwriting it.
 *
 * Specialties and languages are `ReadonlyArray<string>` on the contract. They are edited
 * as comma-separated text and split/joined at the boundary, so the form state stays a
 * plain string and the API receives a trimmed array with no empty entries.
 *
 * `consultation_fee_sen` is integer sen. The input shows the raw integer; a formatted
 * `formatSen()` preview sits beneath it so the doctor sees `MYR 150.00` while typing
 * `15000`. Money is never sent as a formatted string — the server receives the integer.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import { ApiError } from '@/lib/api/client';
import { readDoctorDetails, updateDoctorDetails, formatSen, shortId } from '@/lib/api/directory';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge from '@/components/ui/badge';
import ResourceState from '@/components/data/ResourceState';

interface DoctorFormState {
  biography: string;
  yearsExperience: string;
  consultationFeeSen: string;
  acceptsNewPatients: boolean;
  specialties: string;
  languages: string;
}

const EMPTY_FORM: DoctorFormState = {
  biography: '',
  yearsExperience: '',
  consultationFeeSen: '0',
  acceptsNewPatients: true,
  specialties: '',
  languages: '',
};

/** Splits a comma-separated string into a trimmed, de-duplicated, non-empty array. */
function splitList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed !== '' && !seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase());
      out.push(trimmed);
    }
  }
  return out;
}

function toFormState(
  detail: Readonly<{
    biography: string | null;
    years_experience: number | null;
    consultation_fee_sen: number;
    accepts_new_patients: boolean;
    specialties: ReadonlyArray<string>;
    languages: ReadonlyArray<string>;
  }>,
): DoctorFormState {
  return {
    biography: detail.biography ?? '',
    yearsExperience: detail.years_experience == null ? '' : String(detail.years_experience),
    consultationFeeSen: String(detail.consultation_fee_sen),
    acceptsNewPatients: detail.accepts_new_patients,
    specialties: detail.specialties.join(', '),
    languages: detail.languages.join(', '),
  };
}

export default function DoctorProfilePage() {
  const router = useRouter();
  const { user, activeMembership, isLoading: authLoading } = useAuth();

  // The membership is the authority on which doctor record this is — the id is never
  // taken from the URL or user input. While the membership is still loading, the fetcher
  // rejects so no request fires against an undefined id; the render guard below shows a
  // loader instead of that rejected state.
  const resource = useApiResource(
    (signal) =>
      activeMembership
        ? readDoctorDetails(activeMembership.id, signal)
        : Promise.reject(new Error('No active membership')),
    [activeMembership],
  );
  const detail = resource.data;

  const [form, setForm] = useState<DoctorFormState>(EMPTY_FORM);
  // True while the form holds the not-yet-saved first-time create (a 404 on load).
  const [isCreate, setIsCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Seed the editable fields from the saved record whenever it changes (initial load and
  // after every reload). A mutation acknowledgement is not the new state: re-reading after
  // a save keeps the held version honest, so re-seeding on reload is correct rather than
  // incrementing what we already hold.
  useEffect(() => {
    if (!detail) return;
    setForm(toFormState(detail));
    setIsCreate(false);
  }, [detail]);

  // A 404 means no detail row exists yet — seed the empty create form. Kept in an effect
  // so it runs once the load resolves rather than during render.
  useEffect(() => {
    if (resource.error?.status === 404) {
      setForm(EMPTY_FORM);
      setIsCreate(true);
      setWriteError(null);
    }
  }, [resource.error]);

  // Send a non-doctor away. Matches the dashboard page's guard rather than returning a
  // bare null, so a user who lands here by URL is moved somewhere useful.
  useEffect(() => {
    if (user && user.activeRole !== 'doctor') router.replace('/dashboard');
  }, [user, router]);

  if (authLoading || !user) return <PageLoader label="Loading your workspace..." />;
  if (user.activeRole !== 'doctor') return null;
  if (!activeMembership) return <PageLoader label="Loading your membership..." />;

  const membershipId = activeMembership.id;
  const notFound = resource.error?.status === 404;

  function buildBody(expectedVersion: number) {
    const feeParsed = Number(form.consultationFeeSen);
    const yearsParsed = form.yearsExperience.trim() === '' ? null : Number(form.yearsExperience);
    return {
      biography: form.biography.trim() || null,
      years_experience: yearsParsed,
      consultation_fee_sen: Number.isFinite(feeParsed) ? Math.trunc(feeParsed) : 0,
      currency: 'MYR' as const,
      accepts_new_patients: form.acceptsNewPatients,
      specialties: splitList(form.specialties),
      languages: splitList(form.languages),
      version: expectedVersion,
    };
  }

  function validate(): string | null {
    const fee = Number(form.consultationFeeSen);
    if (!Number.isFinite(fee) || fee < 0 || !Number.isInteger(fee)) {
      return 'Consultation fee must be a whole number of sen (zero or more).';
    }
    const years = form.yearsExperience.trim();
    if (years !== '') {
      const parsed = Number(years);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        return 'Years of experience must be a whole number, or left blank.';
      }
    }
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setWriteError(new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Check your input', detail: validationError }));
      return;
    }
    if (busy) return;
    setBusy(true);
    setWriteError(null);
    setMessage(null);
    try {
      // For a first-time create the resource 404'd, so there is no prior version to
      // guard against: send 0 as the expected-version sentinel. Once it exists, send
      // the loaded version so a concurrent edit is rejected as a 409.
      const expectedVersion = isCreate ? 0 : detail!.version;
      const saved = await updateDoctorDetails(membershipId, buildBody(expectedVersion));
      setMessage(
        isCreate
          ? `Professional profile created (v${saved.version}).`
          : `Professional profile saved (v${saved.version}).`,
      );
      setIsCreate(false);
      await resource.reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
      setWriteError(apiError);
      // A conflict means somebody else wrote first, so the version in hand is stale and
      // retrying with it would fail again. Re-read instead.
      if (apiError.isConflict) {
        setMessage(null);
        await resource.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  const feePreview = (() => {
    const fee = Number(form.consultationFeeSen);
    return Number.isFinite(fee) ? formatSen(fee) : '—';
  })();

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Profile' }]} />
      <div className="flex-1 overflow-y-auto p-6 md:p-8 scroll-smooth">
        <div className="max-w-[1000px] mx-auto w-full flex flex-col gap-6">
          <PageHeader
            title="Professional Profile"
            subtitle="Your public professional details"
          />

          {/* A non-404 load failure is a real error (permission or network), not an empty
              profile, so it goes through ResourceState. A 404 is handled as the create
              flow below rather than rendered as "empty". */}
          {!notFound && (
            <ResourceState
              isLoading={resource.isLoading}
              error={resource.error}
              isEmpty={false}
              onRetry={resource.reload}
              loadingLabel="Loading your professional profile..."
              errorTitle="Could not load your professional profile"
              forbiddenTitle="You cannot view this professional profile"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}

          {(detail || notFound) && !resource.error?.isForbidden && (
            <>
              {notFound && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
                  <span className="font-bold">No professional profile yet.</span>{' '}
                  Fill in the details below to publish your public professional information.
                </div>
              )}

              {/* Saved-state header. Metadata here reflects the persisted record, not the
                  in-progress edit, so version stays truthful mid-edit. */}
              {detail && !notFound && (
                <SectionCard>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-bold text-slate-900">Saved profile</h2>
                    <Badge tone="green">
                      <span className="material-symbols-outlined text-[14px] mr-1">check_circle</span>
                      Published
                    </Badge>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <span className="material-symbols-outlined text-[16px]">history</span>
                      Version {detail.version}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <span className="material-symbols-outlined text-[16px]">badge</span>
                      Membership <code>{shortId(membershipId)}</code>
                    </span>
                  </div>
                </SectionCard>
              )}

              {message && (
                <p role="status" className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                  {message}
                </p>
              )}

              {writeError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                  <p className="text-sm font-bold text-red-800">
                    {writeError.isConflict
                      ? 'This profile changed while you were editing'
                      : writeError.title}
                  </p>
                  <p className="text-sm text-red-700 mt-1">
                    {writeError.isConflict
                      ? 'The profile has been refreshed. Reapply your change and save again.'
                      : writeError.message}
                  </p>
                  {writeError.correlationId && (
                    <p className="text-xs text-red-500 mt-2">
                      Reference: <code>{writeError.correlationId}</code>
                    </p>
                  )}
                </div>
              )}

              <SectionCard title={notFound ? 'Create professional profile' : 'Edit professional profile'} bodyClassName="space-y-5">
                <form onSubmit={submit} className="space-y-5">
                  <div>
                    <label htmlFor="doc-biography" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      Biography
                    </label>
                    <textarea
                      id="doc-biography"
                      rows={5}
                      maxLength={5000}
                      className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none"
                      placeholder="A short professional biography visible to patients..."
                      value={form.biography}
                      onChange={(e) => setForm((prev) => ({ ...prev, biography: e.target.value }))}
                    />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="doc-years" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                        Years of experience
                      </label>
                      <input
                        id="doc-years"
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                        placeholder="e.g. 12"
                        value={form.yearsExperience}
                        onChange={(e) => setForm((prev) => ({ ...prev, yearsExperience: e.target.value }))}
                      />
                      <p className="text-xs text-slate-400 mt-1.5">Leave blank if you prefer not to state this.</p>
                    </div>
                    <div>
                      <label htmlFor="doc-fee" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                        Consultation fee (integer sen)
                      </label>
                      <input
                        id="doc-fee"
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        required
                        className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                        placeholder="e.g. 15000"
                        value={form.consultationFeeSen}
                        onChange={(e) => setForm((prev) => ({ ...prev, consultationFeeSen: e.target.value }))}
                      />
                      <p className="text-xs text-slate-500 mt-1.5">
                        Entered in sen (15000 = <span className="font-bold">{feePreview}</span>). The server stores the integer.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="doc-specialties" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      Specialties
                    </label>
                    <input
                      id="doc-specialties"
                      type="text"
                      maxLength={500}
                      className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                      placeholder="e.g. General practice, Cardiology"
                      value={form.specialties}
                      onChange={(e) => setForm((prev) => ({ ...prev, specialties: e.target.value }))}
                    />
                    <p className="text-xs text-slate-400 mt-1.5">Comma-separated. Replaces the full set on save.</p>
                  </div>

                  <div>
                    <label htmlFor="doc-languages" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      Languages
                    </label>
                    <input
                      id="doc-languages"
                      type="text"
                      maxLength={500}
                      className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                      placeholder="e.g. English, Malay, Mandarin"
                      value={form.languages}
                      onChange={(e) => setForm((prev) => ({ ...prev, languages: e.target.value }))}
                    />
                    <p className="text-xs text-slate-400 mt-1.5">Comma-separated. Replaces the full set on save.</p>
                  </div>

                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 text-[#1e3fae] focus:ring-[#1e3fae]/20"
                      checked={form.acceptsNewPatients}
                      onChange={(e) => setForm((prev) => ({ ...prev, acceptsNewPatients: e.target.checked }))}
                    />
                    <span className="text-sm font-semibold text-slate-700">Accepting new patients</span>
                  </label>

                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 transition-colors shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[20px]">{busy ? 'progress_activity' : 'save'}</span>
                      {busy ? 'Saving...' : notFound ? 'Create profile' : 'Save changes'}
                    </button>
                    {!notFound && (
                      <button
                        type="button"
                        onClick={() => {
                          if (detail) setForm(toFormState(detail));
                          setMessage(null);
                          setWriteError(null);
                        }}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">restart_alt</span>
                        Revert
                      </button>
                    )}
                  </div>
                </form>
              </SectionCard>

              {/* Current specialties/languages as badges, derived from the saved record so
                  they reflect what is published, not the in-progress edit. */}
              {detail && !notFound && (detail.specialties.length > 0 || detail.languages.length > 0) && (
                <SectionCard title="Published details" bodyClassName="space-y-4">
                  {detail.specialties.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Specialties</p>
                      <div className="flex flex-wrap gap-2">
                        {detail.specialties.map((specialty) => (
                          <Badge key={specialty} tone="blue">{specialty}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.languages.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Languages</p>
                      <div className="flex flex-wrap gap-2">
                        {detail.languages.map((language) => (
                          <Badge key={language} tone="teal">{language}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600 pt-2 border-t border-slate-100">
                    <span>
                      Consultation fee: <span className="font-bold text-slate-900">{formatSen(detail.consultation_fee_sen, detail.currency)}</span>
                    </span>
                    <span>
                      Years experience:{' '}
                      <span className="font-bold text-slate-900">
                        {detail.years_experience == null ? '—' : detail.years_experience}
                      </span>
                    </span>
                    <span>
                      New patients:{' '}
                      <span className="font-bold text-slate-900">
                        {detail.accepts_new_patients ? 'Accepted' : 'Not accepted'}
                      </span>
                    </span>
                  </div>
                </SectionCard>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
