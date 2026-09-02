'use client';

/**
 * FAQ management, wired to the real backend at /admin/faqs.
 *
 * RECONCILIATION WITH THE PREVIOUS MOCK, recorded because it is not a swap. `mockFAQs`
 * carried `category` and `views`; the backend model has NEITHER, so the category filter,
 * the category selector and the views counters are gone rather than filled with
 * invented numbers. The backend requires a `slug`, which the mock form never collected,
 * and a `expected_version` on every write. Deletion is a SOFT ARCHIVE: the row is kept
 * so published content history is never erased.
 *
 * Loading, failed and empty are rendered as three distinct states. Collapsing them is
 * how a permission error ends up looking like an empty list.
 */

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import { ApiError } from '@/lib/api/client';
import {
  archiveFaqEntry,
  createFaqEntry,
  listFaqEntries,
  setFaqPublishState,
  updateFaqEntry,
} from '@/lib/api/administration';
import type { FaqEntry } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function publishStateStyle(state: string): string {
  const styles: Record<string, string> = {
    published: 'bg-green-50 text-green-700 border-green-100',
    draft: 'bg-amber-50 text-amber-700 border-amber-100',
    archived: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return styles[state] ?? 'bg-slate-50 text-slate-700 border-slate-100';
}

function formatInstant(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

export default function FAQManagementPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FaqEntry | null>(null);
  const [form, setForm] = useState({ slug: '', question: '', answer: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);

  const { data, isLoading, error, reload } = useApiResource(
    (signal) => listFaqEntries({ signal }),
    [],
  );

  const entries = useMemo(() => data?.data ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (needle === '') return entries;
    return entries.filter(
      (entry) =>
        entry.question.toLowerCase().includes(needle) ||
        entry.answer.toLowerCase().includes(needle) ||
        entry.slug.toLowerCase().includes(needle),
    );
  }, [entries, searchQuery]);

  const publishedCount = useMemo(
    () => entries.filter((entry) => entry.publish_state === 'published').length,
    [entries],
  );
  const draftCount = useMemo(
    () => entries.filter((entry) => entry.publish_state === 'draft').length,
    [entries],
  );

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm({ slug: '', question: '', answer: '' });
    setWriteError(null);
    setIsDialogOpen(true);
  }, []);

  const openEdit = useCallback((entry: FaqEntry) => {
    setEditing(entry);
    setForm({ slug: entry.slug, question: entry.question, answer: entry.answer });
    setWriteError(null);
    setIsDialogOpen(true);
  }, []);

  /** Every write funnels through here so conflict handling is defined in one place. */
  const runWrite = useCallback(
    async (operation: () => Promise<unknown>) => {
      setIsSaving(true);
      setWriteError(null);
      try {
        await operation();
        setIsDialogOpen(false);
        reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setWriteError(apiError);
        // A conflict means somebody else wrote first, so the version in hand is stale
        // and retrying with it would fail again. Re-read instead.
        if (apiError.isConflict) reload();
      } finally {
        setIsSaving(false);
      }
    },
    [reload],
  );

  const submit = useCallback(() => {
    const slug = form.slug.trim() === '' ? slugify(form.question) : form.slug.trim();
    if (!SLUG_PATTERN.test(slug)) {
      setWriteError(
        new ApiError({
          status: 0,
          code: 'CLIENT_ERROR',
          title: 'Invalid slug',
          detail: 'Use lowercase letters, numbers and single hyphens, for example how-to-book.',
        }),
      );
      return;
    }
    const question = form.question.trim();
    const answer = form.answer.trim();
    if (question === '' || answer === '') {
      setWriteError(
        new ApiError({
          status: 0,
          code: 'CLIENT_ERROR',
          title: 'Question and answer are required',
        }),
      );
      return;
    }

    void runWrite(() =>
      editing
        ? updateFaqEntry(editing.faq_entry_id, {
            slug,
            question,
            answer,
            expected_version: editing.version,
          })
        : createFaqEntry({ slug, question, answer }),
    );
  }, [editing, form, runWrite]);

  const togglePublish = useCallback(
    (entry: FaqEntry) =>
      void runWrite(() =>
        setFaqPublishState(entry.faq_entry_id, {
          publish_state: entry.publish_state === 'published' ? 'draft' : 'published',
          expected_version: entry.version,
        }),
      ),
    [runWrite],
  );

  const archive = useCallback(
    (entry: FaqEntry) =>
      void runWrite(() =>
        archiveFaqEntry(entry.faq_entry_id, { expected_version: entry.version }),
      ),
    [runWrite],
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
      <TopBar breadcrumbs={[{ label: 'Support' }, { label: 'FAQ Management' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">FAQ Management</h1>
              <p className="text-slate-500 mt-1">
                Published entries are visible to patients. Archived entries are retained, never deleted.
              </p>
            </div>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#1e3fae] text-white rounded-lg font-bold text-sm shadow-md hover:bg-blue-700 transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
              Add New FAQ
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'help', tint: 'text-blue-600', label: 'Total', value: entries.length, note: 'All entries' },
              { icon: 'visibility', tint: 'text-green-600', label: 'Published', value: publishedCount, note: 'Visible to patients' },
              { icon: 'edit_note', tint: 'text-amber-600', label: 'Drafts', value: draftCount, note: 'Not yet visible' },
            ].map((card) => (
              <div key={card.label} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className={`material-symbols-outlined ${card.tint} text-2xl`}>{card.icon}</span>
                  <span className="text-xs font-bold text-slate-500">{card.label}</span>
                </div>
                <p className="text-3xl font-bold text-slate-900">{isLoading ? '—' : card.value}</p>
                <p className="text-xs text-slate-500 mt-1">{card.note}</p>
              </div>
            ))}
          </div>

          <div className="relative w-full group">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1e3fae] transition-colors">
              <span className="material-symbols-outlined">search</span>
            </span>
            <input
              className="w-full bg-white text-sm text-slate-900 rounded-lg border border-slate-200 pl-10 pr-4 py-3 placeholder-slate-400 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all shadow-sm"
              placeholder="Search FAQs by question, answer, or slug..."
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          {isLoading && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3fae]"></div>
              <p className="text-sm text-slate-500">Loading FAQ entries…</p>
            </div>
          )}

          {!isLoading && error && (
            <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8" role="alert">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600">error</span>
                <div className="flex-1">
                  <h2 className="font-bold text-slate-900">
                    {error.isForbidden
                      ? 'You do not have permission to manage content'
                      : 'Could not load FAQ entries'}
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">{error.message}</p>
                  {error.correlationId && (
                    <p className="text-xs text-slate-400 mt-2">
                      Reference: <code>{error.correlationId}</code>
                    </p>
                  )}
                  {!error.isForbidden && (
                    <button
                      onClick={reload}
                      className="mt-4 px-4 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isLoading && !error && filtered.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">help</span>
              <h2 className="font-bold text-slate-900 mt-3">
                {entries.length === 0 ? 'No FAQ entries yet' : 'No entries match your search'}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {entries.length === 0
                  ? 'Create the first entry to publish guidance for patients.'
                  : 'Try a different question, answer or slug.'}
              </p>
            </div>
          )}

          {!isLoading && !error && filtered.length > 0 && (
            <div className="space-y-4">
              {filtered.map((entry) => (
                <div
                  key={entry.faq_entry_id}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="material-symbols-outlined text-[#1e3fae] text-xl">help</span>
                        <h3 className="text-lg font-bold text-slate-900">{entry.question}</h3>
                      </div>
                      <p className="text-slate-600 mb-4 leading-relaxed">{entry.answer}</p>
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${publishStateStyle(entry.publish_state)}`}
                        >
                          {entry.publish_state}
                        </span>
                        <span className="text-slate-400">•</span>
                        <code className="text-xs text-slate-500">{entry.slug}</code>
                        <span className="text-slate-400">•</span>
                        <span className="text-slate-500">Updated {formatInstant(entry.updated_at)}</span>
                        {entry.published_at && (
                          <>
                            <span className="text-slate-400">•</span>
                            <span className="text-slate-500">
                              Published {formatInstant(entry.published_at)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {entry.publish_state !== 'archived' && (
                        <button
                          onClick={() => togglePublish(entry)}
                          disabled={isSaving}
                          className="p-2 text-slate-400 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-40"
                          title={entry.publish_state === 'published' ? 'Return to draft' : 'Publish'}
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            {entry.publish_state === 'published' ? 'visibility_off' : 'publish'}
                          </span>
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(entry)}
                        className="p-2 text-slate-400 hover:text-[#1e3fae] hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <span className="material-symbols-outlined text-[20px]">edit</span>
                      </button>
                      {entry.publish_state !== 'archived' && (
                        <button
                          onClick={() => archive(entry)}
                          disabled={isSaving}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                          title="Archive (retained, not deleted)"
                        >
                          <span className="material-symbols-outlined text-[20px]">archive</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && !error && entries.length > 0 && (
            <div className="py-4">
              <span className="text-sm text-slate-500">
                Showing <span className="font-bold text-slate-900">{filtered.length}</span> of{' '}
                <span className="font-bold text-slate-900">{entries.length}</span> FAQs
              </span>
            </div>
          )}
        </div>
      </div>

      {isDialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900">
                  {editing ? 'Edit FAQ' : 'Add New FAQ'}
                </h2>
                <button
                  onClick={() => setIsDialogOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              {writeError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                  <p className="text-sm font-bold text-red-800">
                    {writeError.isConflict
                      ? 'This entry changed while you were editing'
                      : writeError.title}
                  </p>
                  <p className="text-sm text-red-700 mt-1">
                    {writeError.isConflict
                      ? 'The list has been refreshed. Reopen the entry and reapply your change.'
                      : writeError.message}
                  </p>
                </div>
              )}
              <div>
                <label htmlFor="faq-question" className="block text-sm font-bold text-slate-700 mb-2">
                  Question
                </label>
                <input
                  id="faq-question"
                  type="text"
                  maxLength={500}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                  placeholder="Enter the question..."
                  value={form.question}
                  onChange={(event) => setForm((prev) => ({ ...prev, question: event.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="faq-answer" className="block text-sm font-bold text-slate-700 mb-2">
                  Answer
                </label>
                <textarea
                  id="faq-answer"
                  rows={6}
                  maxLength={12000}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none"
                  placeholder="Enter the answer..."
                  value={form.answer}
                  onChange={(event) => setForm((prev) => ({ ...prev, answer: event.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="faq-slug" className="block text-sm font-bold text-slate-700 mb-2">
                  Slug
                </label>
                <input
                  id="faq-slug"
                  type="text"
                  maxLength={80}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono text-sm"
                  placeholder={slugify(form.question) || 'how-to-book'}
                  value={form.slug}
                  onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
                />
                <p className="text-xs text-slate-500 mt-2">
                  Stable identifier used in URLs. Leave blank to derive it from the question. Must be
                  unique within the organization.
                </p>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setIsDialogOpen(false)}
                  className="flex-1 px-4 py-3 border border-slate-200 rounded-lg text-slate-700 font-bold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={isSaving}
                  className="flex-1 px-4 py-3 bg-[#1e3fae] text-white rounded-lg font-bold hover:bg-blue-700 shadow-md transition-colors disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : editing ? 'Update FAQ' : 'Create FAQ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
