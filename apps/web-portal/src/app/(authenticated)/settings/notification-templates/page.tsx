'use client';

/**
 * Notification template management, wired to the real backend at
 * /admin/notification-templates.
 *
 * RECONCILIATION NOTE: the task spec mentioned a "channel (email/sms/push)" field, but
 * the generated contract does not model a channel on NotificationTemplate — the closest
 * classification is `category` (account_security, appointments, …). That is what is shown
 * here. Fabricating a channel the API never sends would be the mock-to-real trap this
 * codebase avoids: a field the API stops sending becomes undefined in a table, so it is
 * not invented.
 *
 * The API exposes `active_version` (number | null) as the only lifecycle signal. A
 * template with an active version is "active"; one without is a "draft". The contract
 * does not model an "archived" status, so it is not fabricated.
 *
 * Loading, failed and empty are rendered as three distinct states via ResourceState.
 * A forbidden (403) error gets no retry button, per the component contract.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import ResourceState from '@/components/data/ResourceState';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiResource } from '@/hooks/use-api-resource';
import { ApiError } from '@/lib/api/client';
import {
  activateNotificationTemplateVersion,
  addNotificationTemplateVersion,
  createNotificationTemplate,
  listNotificationTemplates,
  listNotificationTemplateVersions,
} from '@/lib/api/administration';
import type {
  NotificationTemplate,
  NotificationTemplateVersion,
} from '@/types/contracts';

// ---------------------------------------------------------------------------
// Vocabulary — declared once as a const array so the select options, the badge
// tone map and the label map all derive from the same definition. Never retype
// an enum; this is the known subset of the generated category union.
// ---------------------------------------------------------------------------

const TEMPLATE_CATEGORIES = [
  'account_security',
  'appointments',
  'consultations',
  'messages',
  'prescriptions',
  'vitals_alerts',
  'ai_review',
  'delivery',
  'emergency',
  'system',
] as const;

type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

const CATEGORY_TONE: Record<TemplateCategory, BadgeTone> = {
  account_security: 'red',
  appointments: 'blue',
  consultations: 'teal',
  messages: 'indigo',
  prescriptions: 'purple',
  vitals_alerts: 'orange',
  ai_review: 'purple',
  delivery: 'amber',
  emergency: 'red',
  system: 'slate',
};

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  account_security: 'Account Security',
  appointments: 'Appointments',
  consultations: 'Consultations',
  messages: 'Messages',
  prescriptions: 'Prescriptions',
  vitals_alerts: 'Vitals Alerts',
  ai_review: 'AI Review',
  delivery: 'Delivery',
  emergency: 'Emergency',
  system: 'System',
};

/** Handles UnknownEnumValue gracefully — show the raw value rather than crashing. */
function categoryLabel(category: string): string {
  return category in CATEGORY_LABELS
    ? CATEGORY_LABELS[category as TemplateCategory]
    : category;
}

function categoryTone(category: string): BadgeTone {
  return category in CATEGORY_TONE
    ? CATEGORY_TONE[category as TemplateCategory]
    : 'slate';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatInstant(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

/**
 * Derives the display status from `active_version`, the only lifecycle field the API
 * exposes. active_version !== null → active; null → draft. No "archived" is fabricated
 * because the contract does not model it.
 */
function templateStatus(
  activeVersion: number | null,
): { label: string; tone: BadgeTone } {
  if (activeVersion !== null) return { label: 'Active', tone: 'green' };
  return { label: 'Draft', tone: 'amber' };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NotificationTemplatesPage() {
  const { data, isLoading, error, reload } = useApiResource(
    (signal) => listNotificationTemplates(signal),
    [],
  );

  const templates = useMemo(() => data?.data ?? [], [data]);

  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({
    template_key: '',
    category: 'appointments' as TemplateCategory,
    title_template: '',
    body_template: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);

  // Version history: one template expanded at a time. Fetched on demand because
  // loading every template's versions up front would be N+1 requests.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [versions, setVersions] = useState<readonly NotificationTemplateVersion[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<ApiError | null>(null);
  const [activatingVersion, setActivatingVersion] = useState<number | null>(null);
  // Incremented to force a version-history refetch after an activation mutates state.
  const [versionsNonce, setVersionsNonce] = useState(0);

  // Add-version modal state. One modal serves whichever template is expanded.
  const [addVersionFor, setAddVersionFor] = useState<string | null>(null);
  const [versionForm, setVersionForm] = useState({
    title_template: '',
    body_template: '',
  });
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [versionError, setVersionError] = useState<ApiError | null>(null);

  const filtered = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (needle === '') return templates;
    return templates.filter(
      (t) =>
        t.template_key.toLowerCase().includes(needle) ||
        t.category.toLowerCase().includes(needle),
    );
  }, [templates, searchQuery]);

  const activeCount = useMemo(
    () => templates.filter((t) => t.active_version !== null).length,
    [templates],
  );
  const draftCount = useMemo(
    () => templates.filter((t) => t.active_version === null).length,
    [templates],
  );

  // Fetch version history whenever the expanded template or the refetch nonce changes.
  useEffect(() => {
    if (expandedKey === null) {
      setVersions(null);
      setVersionsError(null);
      return;
    }
    const controller = new AbortController();
    setVersionsLoading(true);
    setVersionsError(null);
    listNotificationTemplateVersions(expandedKey, controller.signal)
      .then((result) => setVersions(result.data ?? []))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setVersionsError(
          caught instanceof ApiError
            ? caught
            : new ApiError({
                status: 0,
                code: 'CLIENT_ERROR',
                title: 'Unexpected client error',
                detail: caught instanceof Error ? caught.message : String(caught),
              }),
        );
      })
      .finally(() => setVersionsLoading(false));
    return () => controller.abort();
  }, [expandedKey, versionsNonce]);

  const toggleExpand = useCallback((template: NotificationTemplate) => {
    setExpandedKey((prev) =>
      prev === template.template_key ? null : template.template_key,
    );
  }, []);

  const openCreate = useCallback(() => {
    setForm({
      template_key: '',
      category: 'appointments',
      title_template: '',
      body_template: '',
    });
    setWriteError(null);
    setIsCreateOpen(true);
  }, []);

  const submitCreate = useCallback(async () => {
    const templateKey = form.template_key.trim();
    const titleTemplate = form.title_template.trim();
    const bodyTemplate = form.body_template.trim();

    if (templateKey === '' || titleTemplate === '' || bodyTemplate === '') {
      setWriteError(
        new ApiError({
          status: 0,
          code: 'CLIENT_ERROR',
          title: 'All fields are required',
          detail: 'Template key, title template and body template cannot be empty.',
        }),
      );
      return;
    }

    setIsSaving(true);
    setWriteError(null);
    try {
      await createNotificationTemplate({
        template_key: templateKey,
        category: form.category,
        title_template: titleTemplate,
        body_template: bodyTemplate,
      });
      setIsCreateOpen(false);
      reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({
              status: 0,
              code: 'CLIENT_ERROR',
              title: 'Unexpected client error',
              detail: caught instanceof Error ? caught.message : String(caught),
            });
      setWriteError(apiError);
    } finally {
      setIsSaving(false);
    }
  }, [form, reload]);

  const activateVersion = useCallback(
    async (templateKey: string, version: number) => {
      setActivatingVersion(version);
      try {
        await activateNotificationTemplateVersion(templateKey, { version });
        // Force a version-history refetch so the new active state is reflected,
        // and refresh the template list so active_version updates.
        setVersionsNonce((n) => n + 1);
        reload();
      } catch (caught) {
        setVersionsError(
          caught instanceof ApiError
            ? caught
            : new ApiError({
                status: 0,
                code: 'CLIENT_ERROR',
                title: 'Could not activate version',
                detail: caught instanceof Error ? caught.message : String(caught),
              }),
        );
      } finally {
        setActivatingVersion(null);
      }
    },
    [reload],
  );

  const openAddVersion = useCallback((templateKey: string) => {
    setAddVersionFor(templateKey);
    setVersionForm({ title_template: '', body_template: '' });
    setVersionError(null);
  }, []);

  const closeAddVersion = useCallback(() => {
    setAddVersionFor(null);
    setVersionError(null);
  }, []);

  const submitAddVersion = useCallback(async () => {
    if (!addVersionFor) return;
    const titleTemplate = versionForm.title_template.trim();
    const bodyTemplate = versionForm.body_template.trim();
    if (titleTemplate === '' || bodyTemplate === '') {
      setVersionError(
        new ApiError({
          status: 0,
          code: 'CLIENT_ERROR',
          title: 'All fields are required',
          detail: 'Title template and body template cannot be empty.',
        }),
      );
      return;
    }
    setIsSavingVersion(true);
    setVersionError(null);
    try {
      await addNotificationTemplateVersion(addVersionFor, {
        title_template: titleTemplate,
        body_template: bodyTemplate,
      });
      // Refresh the version history for this template so the new version appears,
      // and refresh the template list so updated_at reflects the change.
      setAddVersionFor(null);
      setVersionsNonce((n) => n + 1);
      reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({
              status: 0,
              code: 'CLIENT_ERROR',
              title: 'Unexpected client error',
              detail: caught instanceof Error ? caught.message : String(caught),
            });
      setVersionError(apiError);
    } finally {
      setIsSavingVersion(false);
    }
  }, [addVersionFor, versionForm, reload]);

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Settings' }, { label: 'Notification Templates' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Notification Templates"
            subtitle="Manage reusable notification templates and their version history. Activate a version to make it the live template."
            actions={
              <Button
                onClick={openCreate}
                className="flex items-center gap-2 bg-[#1e3fae] text-white rounded-lg font-bold text-sm shadow-md hover:bg-blue-700 transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">add</span>
                Create Template
              </Button>
            }
          />

          {/* Stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                icon: 'notifications',
                tint: 'text-blue-600',
                label: 'Total',
                value: templates.length,
                note: 'All templates',
              },
              {
                icon: 'check_circle',
                tint: 'text-green-600',
                label: 'Active',
                value: activeCount,
                note: 'With an active version',
              },
              {
                icon: 'edit_note',
                tint: 'text-amber-600',
                label: 'Drafts',
                value: draftCount,
                note: 'No active version yet',
              },
            ].map((card) => (
              <div
                key={card.label}
                className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`material-symbols-outlined ${card.tint} text-2xl`}>
                    {card.icon}
                  </span>
                  <span className="text-xs font-bold text-slate-500">{card.label}</span>
                </div>
                <p className="text-3xl font-bold text-slate-900">
                  {isLoading ? '—' : card.value}
                </p>
                <p className="text-xs text-slate-500 mt-1">{card.note}</p>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="relative w-full group">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1e3fae] transition-colors">
              <span className="material-symbols-outlined">search</span>
            </span>
            <input
              className="w-full bg-white text-sm text-slate-900 rounded-lg border border-slate-200 pl-10 pr-4 py-3 placeholder-slate-400 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all shadow-sm"
              placeholder="Search templates by key or category..."
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          {/* Loading / error / empty states */}
          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={!isLoading && !error && filtered.length === 0}
            onRetry={reload}
            loadingLabel="Loading notification templates…"
            forbiddenTitle="Template access denied"
            errorTitle="Could not load notification templates"
            emptyIcon="notifications_active"
            emptyTitle={
              templates.length === 0
                ? 'No notification templates yet'
                : 'No templates match your search'
            }
            emptyBody={
              templates.length === 0
                ? 'Create the first template to define reusable notification content.'
                : 'Try a different template key or category.'
            }
          />

          {/* Template list */}
          {!isLoading && !error && filtered.length > 0 && (
            <SectionCard
              title="Templates"
              action={
                <span className="text-sm text-slate-500">
                  Showing {filtered.length} of {templates.length}
                </span>
              }
              bodyClassName="p-0"
            >
              <div className="divide-y divide-slate-100">
                {filtered.map((template) => {
                  const status = templateStatus(template.active_version);
                  const isExpanded = expandedKey === template.template_key;
                  return (
                    <div key={template.notification_template_id}>
                      {/* Template row */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(template)}
                        className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <span className="material-symbols-outlined text-[#1e3fae] text-xl shrink-0">
                            notifications
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-3 flex-wrap">
                              <h3 className="text-base font-bold text-slate-900 truncate">
                                {template.template_key}
                              </h3>
                              <Badge tone={categoryTone(template.category)}>
                                {categoryLabel(template.category)}
                              </Badge>
                              <Badge tone={status.tone}>{status.label}</Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                              <span>
                                Active version:{' '}
                                <span className="font-bold text-slate-700">
                                  {template.active_version !== null
                                    ? `v${template.active_version}`
                                    : '—'}
                                </span>
                              </span>
                              <span className="text-slate-300">•</span>
                              <span>Updated {formatInstant(template.updated_at)}</span>
                            </div>
                          </div>
                        </div>
                        <span
                          className={`material-symbols-outlined text-slate-400 shrink-0 transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        >
                          expand_more
                        </span>
                      </button>

                      {/* Version history (expanded) */}
                      {isExpanded && (
                        <div className="bg-slate-50 px-5 py-5 border-t border-slate-100">
                          <div className="flex items-center justify-between gap-2 mb-4">
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-slate-500 text-[20px]">
                                history
                              </span>
                              <h4 className="text-sm font-bold text-slate-700">
                                Version history
                              </h4>
                            </div>
                            <button
                              type="button"
                              onClick={() => openAddVersion(template.template_key)}
                              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1e3fae] hover:text-[#1a3695] transition-colors"
                            >
                              <span className="material-symbols-outlined text-[18px]">add_circle</span>
                              Add version
                            </button>
                          </div>

                          {versionsLoading && (
                            <div className="flex items-center gap-3 py-4">
                              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#1e3fae]"></div>
                              <p className="text-sm text-slate-500">
                                Loading versions…
                              </p>
                            </div>
                          )}

                          {versionsError && (
                            <div
                              className="rounded-lg border border-red-200 bg-red-50 p-4"
                              role="alert"
                            >
                              <p className="text-sm font-bold text-red-800">
                                {versionsError.isForbidden
                                  ? 'Permission denied'
                                  : versionsError.title}
                              </p>
                              <p className="text-sm text-red-700 mt-1">
                                {versionsError.message}
                              </p>
                              {!versionsError.isForbidden && (
                                <button
                                  onClick={() =>
                                    setVersionsNonce((n) => n + 1)
                                  }
                                  className="mt-3 px-4 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-white transition-colors"
                                >
                                  Try again
                                </button>
                              )}
                            </div>
                          )}

                          {!versionsLoading && !versionsError && versions !== null && (
                            <>
                              {versions.length === 0 ? (
                                <p className="text-sm text-slate-500 py-4">
                                  No versions have been created for this template yet.
                                </p>
                              ) : (
                                <div className="space-y-3">
                                  {versions
                                    .slice()
                                    .sort((a, b) => b.version - a.version)
                                    .map((version) => {
                                      const isActiveVersion =
                                        template.active_version === version.version;
                                      return (
                                        <div
                                          key={version.notification_template_version_id}
                                          className="bg-white rounded-lg border border-slate-200 p-4"
                                        >
                                          <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0 flex-1">
                                              <div className="flex items-center gap-3 flex-wrap mb-2">
                                                <span className="text-sm font-bold text-slate-900">
                                                  v{version.version}
                                                </span>
                                                {isActiveVersion ? (
                                                  <Badge tone="green">
                                                    Active
                                                  </Badge>
                                                ) : (
                                                  <Badge tone="slate">
                                                    Inactive
                                                  </Badge>
                                                )}
                                                <span className="text-xs text-slate-400">
                                                  {formatInstant(version.created_at)}
                                                </span>
                                              </div>
                                              <div className="space-y-1">
                                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                                  Title template
                                                </p>
                                                <p className="text-sm text-slate-700 font-mono break-all">
                                                  {version.title_template}
                                                </p>
                                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-2">
                                                  Body template
                                                </p>
                                                <p className="text-sm text-slate-700 font-mono break-all whitespace-pre-wrap">
                                                  {version.body_template}
                                                </p>
                                              </div>
                                            </div>
                                            {!isActiveVersion && (
                                              <Button
                                                onClick={() =>
                                                  activateVersion(
                                                    template.template_key,
                                                    version.version,
                                                  )
                                                }
                                                disabled={
                                                  activatingVersion !== null
                                                }
                                                className="shrink-0 text-xs font-bold px-3 py-2 bg-[#1e3fae] text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                                              >
                                                {activatingVersion === version.version
                                                  ? 'Activating…'
                                                  : 'Activate'}
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* Create template modal */}
          {isCreateOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-slate-200">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-slate-900">
                      Create Notification Template
                    </h2>
                    <button
                      onClick={() => setIsCreateOpen(false)}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  {writeError && (
                    <div
                      className="rounded-lg border border-red-200 bg-red-50 p-4"
                      role="alert"
                    >
                      <p className="text-sm font-bold text-red-800">
                        {writeError.isConflict
                          ? 'This template changed while you were editing'
                          : writeError.title}
                      </p>
                      <p className="text-sm text-red-700 mt-1">
                        {writeError.isConflict
                          ? 'The list has been refreshed. Reopen and reapply your change.'
                          : writeError.message}
                      </p>
                    </div>
                  )}

                  {/* Template key */}
                  <div className="space-y-2">
                    <Label htmlFor="template-key">Template key</Label>
                    <Input
                      id="template-key"
                      type="text"
                      maxLength={120}
                      className="font-mono text-sm"
                      placeholder="e.g. appointment-reminder"
                      value={form.template_key}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          template_key: event.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-slate-500">
                      Stable identifier for this template. Use lowercase letters, numbers
                      and hyphens. Must be unique.
                    </p>
                  </div>

                  {/* Category */}
                  <div className="space-y-2">
                    <Label htmlFor="template-category">Category</Label>
                    <select
                      id="template-category"
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all text-sm"
                      value={form.category}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          category: event.target.value as TemplateCategory,
                        }))
                      }
                    >
                      {TEMPLATE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500">
                      The notification category this template belongs to.
                    </p>
                  </div>

                  {/* Title template */}
                  <div className="space-y-2">
                    <Label htmlFor="title-template">Title template</Label>
                    <Input
                      id="title-template"
                      type="text"
                      maxLength={500}
                      className="font-mono text-sm"
                      placeholder="e.g. Appointment reminder: {{appointment_date}}"
                      value={form.title_template}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          title_template: event.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-slate-500">
                      The notification title. Use {'{{variables}}'} for dynamic content.
                    </p>
                  </div>

                  {/* Body template */}
                  <div className="space-y-2">
                    <Label htmlFor="body-template">Body template</Label>
                    <textarea
                      id="body-template"
                      rows={6}
                      maxLength={12000}
                      className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none font-mono text-sm"
                      placeholder="e.g. Your appointment with Dr. {{doctor_name}} is on {{appointment_date}} at {{appointment_time}}."
                      value={form.body_template}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          body_template: event.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-slate-500">
                      The notification body. Use {'{{variables}}'} for dynamic content.
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() => setIsCreateOpen(false)}
                      className="flex-1 px-4 py-3 border border-slate-200 rounded-lg text-slate-700 font-bold hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitCreate}
                      disabled={isSaving}
                      className="flex-1 px-4 py-3 bg-[#1e3fae] text-white rounded-lg font-bold hover:bg-blue-700 shadow-md transition-colors disabled:opacity-50"
                    >
                      {isSaving ? 'Creating…' : 'Create Template'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Add version modal */}
          {addVersionFor && (
            <div
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
              role="dialog"
              aria-modal="true"
            >
              <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-slate-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Add version</h2>
                      <p className="text-xs text-slate-500 font-mono mt-1">
                        {addVersionFor}
                      </p>
                    </div>
                    <button
                      onClick={closeAddVersion}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      aria-label="Close"
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  {versionError && (
                    <div
                      className="rounded-lg border border-red-200 bg-red-50 p-4"
                      role="alert"
                    >
                      <p className="text-sm font-bold text-red-800">
                        {versionError.isConflict
                          ? 'This template changed while you were editing'
                          : versionError.title}
                      </p>
                      <p className="text-sm text-red-700 mt-1">
                        {versionError.isConflict
                          ? 'The list has been refreshed. Reopen and reapply your change.'
                          : versionError.message}
                      </p>
                    </div>
                  )}

                  <p className="text-xs text-slate-500">
                    Append-only: a new version is added without mutating prior versions.
                    Activate it separately to make it the live template.
                  </p>

                  <div className="space-y-2">
                    <Label htmlFor="version-title">Title template</Label>
                    <Input
                      id="version-title"
                      type="text"
                      maxLength={500}
                      className="font-mono text-sm"
                      placeholder="e.g. Appointment reminder: {{appointment_date}}"
                      value={versionForm.title_template}
                      onChange={(event) =>
                        setVersionForm((prev) => ({
                          ...prev,
                          title_template: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="version-body">Body template</Label>
                    <textarea
                      id="version-body"
                      rows={6}
                      maxLength={12000}
                      className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none font-mono text-sm"
                      placeholder="e.g. Your appointment with Dr. {{doctor_name}} is on {{appointment_date}}."
                      value={versionForm.body_template}
                      onChange={(event) =>
                        setVersionForm((prev) => ({
                          ...prev,
                          body_template: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={closeAddVersion}
                      className="flex-1 px-4 py-3 border border-slate-200 rounded-lg text-slate-700 font-bold hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitAddVersion}
                      disabled={isSavingVersion}
                      className="flex-1 px-4 py-3 bg-[#1e3fae] text-white rounded-lg font-bold hover:bg-blue-700 shadow-md transition-colors disabled:opacity-50"
                    >
                      {isSavingVersion ? 'Adding…' : 'Add version'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
