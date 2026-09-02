'use client';

/**
 * Membership administration, wired to GET /organizations/{organization_id}/memberships.
 *
 * THE ORGANIZATION IS TAKEN FROM THE ACTIVE MEMBERSHIP, never from the URL or a picker. A
 * supplied id could only ever name the organization the caller already reaches, so offering
 * the choice would imply an authority the session does not grant.
 *
 * WHAT THIS PAGE CANNOT SHOW, and why it is still worth having. `MembershipAdministrationView`
 * carries identifiers, a role, a status, a verification state and site links — but NO name
 * and NO email, because no endpoint in the API resolves another person's name. That is a real
 * gap, not an oversight of this page. It is acceptable here because this screen's job is
 * access management — who holds which role, in what state, over which sites — and every field
 * that job needs is present. It would NOT be acceptable on a page whose purpose is to
 * identify people, which is why the patient directory is deliberately still unwired.
 *
 * So the mock's names, emails, avatars and last-login times are removed rather than
 * approximated. Inventing them would misrepresent what the server knows.
 *
 * MUTATIONS. Three admin actions are wired, all requiring MFA step-up and CSRF:
 *  - Transition membership status (activate / suspend / revoke) with a reason code and
 *    optimistic-concurrency `expected_version` from the row as read. A 409 re-reads the list.
 *  - Create a membership invitation (profile id + role + site ids), idempotency-keyed.
 *  - Assign or clear a custom role on a membership, optimistic-concurrency versioned.
 * The custom-role picker is populated from `listCustomRoles`, loaded once and shared.
 */

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  PRIVILEGED_ROLES,
  ROLE_STYLE,
  STATUS_STYLE,
  VERIFICATION_AWAITING_ACTION,
  VERIFICATION_STYLE,
  createMembershipInvitation,
  formatInstant,
  humaniseCode,
  listMemberships,
  shortId,
  transitionMembershipStatus,
} from '@/lib/api/directory';
import type {
  CustomRole,
  MembershipAdministrationView,
  MembershipStatus,
  RoleId,
  UnknownEnumValue,
} from '@/types/contracts';
import {
  assignMembershipCustomRole,
  listCustomRoles,
} from '@/lib/api/administration';
import { ApiError } from '@/lib/api/client';
import TopBar from '@/components/layout/TopBar';

/** The known members of an enum, excluding the forward-compatibility escape hatch. */
type Known<T> = Exclude<T, UnknownEnumValue>;

/**
 * The statuses a membership may be transitioned INTO. The transition endpoint accepts only
 * `active`, `suspended` and `revoked` — `applied`, `invited` and `expired` are not admin
 * outcomes, so they are not offered here. This mirrors the request body's union exactly,
 * not the broader `MembershipStatus` enum.
 */
type TransitionTargetStatus = 'active' | 'suspended' | 'revoked';
const TRANSITION_TARGETS: ReadonlyArray<TransitionTargetStatus> = [
  'active',
  'suspended',
  'revoked',
];

/** Reason codes the transition endpoint accepts, declared once so the picker cannot drift. */
type TransitionReasonCode =
  | 'administrative_request'
  | 'verification_revoked'
  | 'verification_approved'
  | 'policy_violation'
  | 'security_incident'
  | 'duplicate_membership'
  | 'offboarding'
  | 'data_correction'
  | 'organization_closed';
const TRANSITION_REASONS: ReadonlyArray<TransitionReasonCode> = [
  'administrative_request',
  'verification_revoked',
  'verification_approved',
  'policy_violation',
  'security_incident',
  'duplicate_membership',
  'offboarding',
  'data_correction',
  'organization_closed',
];

/** Roles a membership invitation may grant. `super_admin` is not invitable. */
type InvitableRole = 'patient' | 'doctor' | 'driver' | 'pharmacy' | 'emergency' | 'admin';
const INVITABLE_ROLES: ReadonlyArray<InvitableRole> = [
  'patient',
  'doctor',
  'driver',
  'pharmacy',
  'emergency',
  'admin',
];

/** Privileged roles first: this screen exists to audit who holds authority. */
const ROLE_WEIGHT: Record<string, number> = {
  super_admin: 0,
  admin: 1,
  doctor: 2,
  pharmacy: 3,
  emergency: 4,
  driver: 5,
  patient: 6,
};

type ModalKind = 'transition' | 'invite' | 'custom-role' | null;

export default function AdminUsersPage() {
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

  // Custom roles are shared across every membership row, so load them once.
  const customRolesResource = useApiResource(
    (signal) => listCustomRoles(signal),
    [],
  );
  const customRoles = useMemo(
    () => (customRolesResource.data?.data ?? []).filter((role) => role.active),
    [customRolesResource.data],
  );

  const memberships = useMemo(() => data?.data ?? [], [data]);

  // Per-action write state. One busy flag and one error slot is enough because only one
  // modal is open at a time; the error follows the modal it was raised in.
  const [modal, setModal] = useState<ModalKind>(null);
  const [activeMembershipRow, setActiveMembershipRow] =
    useState<MembershipAdministrationView | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);

  const openModal = useCallback((kind: ModalKind, row: MembershipAdministrationView | null) => {
    setActiveMembershipRow(row);
    setWriteError(null);
    setModal(kind);
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    setActiveMembershipRow(null);
    setWriteError(null);
  }, []);

  const runWrite = useCallback(
    async (operation: () => Promise<unknown>) => {
      setIsSaving(true);
      setWriteError(null);
      try {
        await operation();
        closeModal();
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
        // A conflict means the version in hand is stale; re-read so a retry is fresh.
        if (apiError.isConflict) reload();
      } finally {
        setIsSaving(false);
      }
    },
    [closeModal, reload],
  );

  /**
   * Ordered by authority held, not by recency. A membership list read for an access audit
   * should put the accounts that can do the most damage at the top.
   */
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
  /*
    Counts BOTH states that still need a human: pending_review and changes_requested. This
    originally tested for 'pending', which is not a value the enum has, so the figure would
    have read zero permanently while looking like a real count. The set is named in the
    resource module so it cannot drift from the vocabulary again.
  */
  const awaiting = useMemo(
    () =>
      memberships.filter((row) =>
        VERIFICATION_AWAITING_ACTION.some((status) => status === row.verification_status),
      ).length,
    [memberships],
  );
  const notActive = useMemo(
    () => memberships.filter((row) => row.status !== 'active').length,
    [memberships],
  );

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  /*
    A DISTINCT state, deliberately not folded into "empty". With no role selected there is no
    organization to scope the query to, so the list would render as "no memberships found" —
    an authorization precondition disguised as an empty result, which is the exact collapse
    ResourceState exists to prevent.
  */
  if (!organizationId) {
    return (
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
        <TopBar breadcrumbs={[{ label: 'Settings' }, { label: 'Members & access' }]} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <span className="material-symbols-outlined text-slate-300 text-5xl">badge</span>
            <h1 className="mt-3 text-lg font-bold text-slate-900">Select a role first</h1>
            <p className="mt-1 text-sm text-slate-500">
              Memberships are listed for the organization of your active role, so one has to be
              selected before this page can load.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Settings' }, { label: 'Members & access' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                Members &amp; access
              </h1>
              <p className="text-slate-500 mt-1">
                Who holds which role in this organization, and over which sites.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openModal('invite', null)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1a3694] transition-colors shadow-sm shrink-0"
            >
              <span className="material-symbols-outlined text-[20px]">person_add</span>
              Invite Member
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { icon: 'group', tint: 'text-blue-600', label: 'Memberships', value: String(memberships.length), note: 'In this organization' },
              { icon: 'admin_panel_settings', tint: 'text-purple-600', label: 'Privileged', value: String(privileged), note: 'Admin or super admin' },
              { icon: 'pending_actions', tint: 'text-amber-600', label: 'Awaiting action', value: String(awaiting), note: 'Review or changes requested' },
              { icon: 'block', tint: 'text-red-600', label: 'Not active', value: String(notActive), note: 'Invited, suspended or revoked' },
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

          {roles.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setRoleFilter('all')}
                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  roleFilter === 'all'
                    ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                All roles
              </button>
              {roles.map((role) => (
                <button
                  key={role}
                  onClick={() => setRoleFilter(role)}
                  className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                    roleFilter === role
                      ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {humaniseCode(role)}
                </button>
              ))}
            </div>
          )}

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={ordered.length === 0}
            onRetry={reload}
            loadingLabel="Loading memberships…"
            forbiddenTitle="You cannot administer memberships"
            errorTitle="Could not load memberships"
            emptyTitle={roleFilter === 'all' ? 'No memberships found' : `No ${humaniseCode(roleFilter)} memberships`}
            emptyBody="Memberships appear here once people are invited or apply."
            emptyIcon="group"
          />

          {!isLoading && !error && ordered.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Organization memberships ordered by the authority each role holds
                </caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Member</th>
                    <th scope="col" className="px-5 py-3">Role</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Verification</th>
                    <th scope="col" className="px-5 py-3 text-right">Sites</th>
                    <th scope="col" className="px-5 py-3">Member since</th>
                    <th scope="col" className="px-5 py-3 text-right">Actions</th>
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
                            // Worth flagging: a site-scoped role without a site holds no
                            // site authority at all, which looks like a permission bug.
                            <span className="text-amber-700 text-xs font-bold">No site</span>
                          ) : (
                            <span className="text-slate-700 font-bold">{row.site_ids.length}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-500">{formatInstant(row.created_at)}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              title="Change membership status"
                              onClick={() => openModal('transition', row)}
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#1e3fae] hover:text-[#1a3695] transition-colors"
                            >
                              <span className="material-symbols-outlined text-[18px]">toggle_on</span>
                              Status
                            </button>
                            <button
                              type="button"
                              title="Assign custom role"
                              onClick={() => openModal('custom-role', row)}
                              className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors"
                            >
                              <span className="material-symbols-outlined text-[18px]">shield_lock</span>
                              Role
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && !error && ordered.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{ordered.length}</span> membership
              {ordered.length === 1 ? '' : 's'}, most privileged first
            </p>
          )}

          {/* Inline conflict / error message from the last write, shown outside any modal */}
          {writeError && !modal && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4" role="alert">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600">error</span>
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900">
                    {writeError.isConflict ? 'Conflict — the membership changed' : writeError.title}
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">{writeError.message}</p>
                  {writeError.correlationId && (
                    <p className="text-xs text-slate-400 mt-2">
                      Reference: <code>{writeError.correlationId}</code>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transition membership status modal */}
      {modal === 'transition' && activeMembershipRow && organizationId && (
        <TransitionMembershipModal
          row={activeMembershipRow}
          isSaving={isSaving}
          error={writeError}
          onClose={closeModal}
          onSubmit={(status, reasonCode) =>
            runWrite(() =>
              transitionMembershipStatus(organizationId, activeMembershipRow.id, {
                status,
                reason_code: reasonCode,
                expected_version: activeMembershipRow.version,
              }),
            )
          }
        />
      )}

      {/* Invite member modal */}
      {modal === 'invite' && organizationId && (
        <InviteMemberModal
          organizationId={organizationId}
          isSaving={isSaving}
          error={writeError}
          onClose={closeModal}
          onSubmit={(body, idempotencyKey) =>
            runWrite(() => createMembershipInvitation(organizationId, body, idempotencyKey))
          }
        />
      )}

      {/* Assign custom role modal */}
      {modal === 'custom-role' && activeMembershipRow && (
        <AssignCustomRoleModal
          row={activeMembershipRow}
          customRoles={customRoles}
          customRolesLoading={customRolesResource.isLoading}
          isSaving={isSaving}
          error={writeError}
          onClose={closeModal}
          onSubmit={(customRoleId) =>
            runWrite(() =>
              assignMembershipCustomRole(activeMembershipRow.id, {
                custom_role_id: customRoleId,
                expected_version: activeMembershipRow.version,
              }),
            )
          }
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Modals                                                                      */
/* -------------------------------------------------------------------------- */

interface ModalShellProps {
  title: string;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}

function ModalShell({ title, isSaving, error, onClose, children, footer }: ModalShellProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          {children}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isConflict
                  ? 'Conflict — the membership changed'
                  : error.needsStepUp
                    ? 'Re-authentication required'
                    : error.isForbidden
                      ? 'Permission denied'
                      : error.title}
              </p>
              <p className="text-xs text-red-600 mt-1">
                {error.needsStepUp
                  ? 'This action requires a recent MFA step-up. Re-authenticate and try again.'
                  : error.message}
              </p>
            </div>
          )}
          {footer}
        </div>
      </div>
    </div>
  );
}

interface TransitionMembershipModalProps {
  row: MembershipAdministrationView;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (status: TransitionTargetStatus, reasonCode: TransitionReasonCode) => void;
}

function TransitionMembershipModal({
  row,
  isSaving,
  error,
  onClose,
  onSubmit,
}: TransitionMembershipModalProps) {
  const [status, setStatus] = useState<TransitionTargetStatus>('active');
  const [reasonCode, setReasonCode] = useState<TransitionReasonCode>(TRANSITION_REASONS[0]);

  return (
    <ModalShell
      title="Change membership status"
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="transition-membership-form"
            disabled={isSaving}
            className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#1a3694] disabled:opacity-50"
          >
            {isSaving ? 'Applying…' : 'Apply'}
          </button>
        </div>
      }
    >
      <p className="text-sm text-slate-600">
        Membership <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">{shortId(row.id)}</code>{' '}
        (profile <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">{shortId(row.profile_id)}</code>).
        Current status: <span className="font-bold">{humaniseCode(row.status)}</span>.
      </p>
      <form
        id="transition-membership-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (isSaving) return;
          onSubmit(status, reasonCode);
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">New status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TransitionTargetStatus)}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
          >
            {TRANSITION_TARGETS.map((s) => (
              <option key={s} value={s}>
                {humaniseCode(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Reason code</span>
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as TransitionReasonCode)}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
          >
            {TRANSITION_REASONS.map((r) => (
              <option key={r} value={r}>
                {humaniseCode(r)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-amber-600 inline-flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">lock_clock</span>
          Requires MFA step-up. The version is quoted optimistically.
        </p>
      </form>
    </ModalShell>
  );
}

interface InviteMemberModalProps {
  organizationId: string;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (
    body: {
      profile_id: string;
      role: InvitableRole;
      site_ids: ReadonlyArray<string>;
    },
    idempotencyKey: string,
  ) => void;
}

function InviteMemberModal({
  isSaving,
  error,
  onClose,
  onSubmit,
}: InviteMemberModalProps) {
  const [profileId, setProfileId] = useState('');
  const [role, setRole] = useState<InvitableRole>(INVITABLE_ROLES[0]);
  const [siteIdsRaw, setSiteIdsRaw] = useState('');

  const canSubmit = profileId.trim() !== '' && !isSaving;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const siteIds = siteIdsRaw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    onSubmit({ profile_id: profileId.trim(), role, site_ids: siteIds }, crypto.randomUUID());
  };

  return (
    <ModalShell
      title="Invite member"
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="invite-member-form"
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#1a3694] disabled:opacity-50"
          >
            {isSaving ? 'Inviting…' : 'Send invitation'}
          </button>
        </div>
      }
    >
      <form id="invite-member-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">
            Profile id <span className="text-red-500">*</span>
          </span>
          <input
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            placeholder="UUIDv7 of an existing profile"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono"
            required
          />
          <span className="text-xs text-slate-500">
            The invitation is sent to an already-registered profile.
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as InvitableRole)}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
          >
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {humaniseCode(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Site ids (optional)</span>
          <input
            value={siteIdsRaw}
            onChange={(e) => setSiteIdsRaw(e.target.value)}
            placeholder="comma- or space-separated UUIDs"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono"
          />
          <span className="text-xs text-slate-500">
            Sites the membership reaches. Omit for an organization-wide role.
          </span>
        </label>
        <p className="text-xs text-amber-600 inline-flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">lock_clock</span>
          Requires MFA step-up. Idempotent on the idempotency key.
        </p>
      </form>
    </ModalShell>
  );
}

interface AssignCustomRoleModalProps {
  row: MembershipAdministrationView;
  customRoles: ReadonlyArray<CustomRole>;
  customRolesLoading: boolean;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (customRoleId: string | null) => void;
}

function AssignCustomRoleModal({
  row,
  customRoles,
  customRolesLoading,
  isSaving,
  error,
  onClose,
  onSubmit,
}: AssignCustomRoleModalProps) {
  const [customRoleId, setCustomRoleId] = useState<string>('');

  const canSubmit = !isSaving;

  return (
    <ModalShell
      title="Assign custom role"
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="assign-custom-role-form"
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#1a3694] disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save assignment'}
          </button>
        </div>
      }
    >
      <p className="text-sm text-slate-600">
        Membership <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">{shortId(row.id)}</code>.
        A custom role adds authority on top of the base role; it cannot subtract.
      </p>
      <form
        id="assign-custom-role-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          onSubmit(customRoleId === '' ? null : customRoleId);
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Custom role</span>
          {customRolesLoading ? (
            <p className="text-xs text-slate-500">Loading custom roles…</p>
          ) : customRoles.length === 0 ? (
            <p className="text-xs text-slate-500">
              No active custom roles are defined. Create one under custom-roles first.
            </p>
          ) : (
            <select
              value={customRoleId}
              onChange={(e) => setCustomRoleId(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
            >
              <option value="">— Clear assignment —</option>
              {customRoles.map((cr) => (
                <option key={cr.custom_role_id} value={cr.custom_role_id}>
                  {cr.display_name} ({humaniseCode(cr.base_role_id)})
                </option>
              ))}
            </select>
          )}
        </label>
        <p className="text-xs text-amber-600 inline-flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">lock_clock</span>
          Requires MFA step-up. The version is quoted optimistically.
        </p>
      </form>
    </ModalShell>
  );
}
