'use client';

/**
 * Roles & permissions, wired to the real backend at /admin/custom-roles and
 * /admin/permissions.
 *
 * The previous page was read-only: it listed custom roles but could not create,
 * edit or re-permission them. This adds three actions, each behind a modal:
 *
 *   - Create Role: POST /admin/custom-roles with a role_key, display_name and
 *     base_role_id.
 *   - Edit Role: PUT /admin/custom-roles/{id} with display_name, active and the
 *     `expected_version` read from the row. A 409 re-reads the list.
 *   - Permissions: PUT /admin/custom-roles/{id}/permissions with the full set of
 *     permission_ids (replace, not patch) and `expected_version`.
 *
 * OPTIMISTIC CONCURRENCY IS NOT OPTIONAL. Every write quotes the version read
 * for that role. A 409 means somebody else wrote first, so the version in hand
 * is stale and retrying with it would fail again — the list is re-read and the
 * modal reports the conflict for the editor to reapply.
 *
 * CUSTOM ROLES ADD, THEY DO NOT SUBTRACT. A custom role cannot remove authority
 * its base role grants, so the permission checkboxes are the additions on top of
 * the base. The catalogue from `listAdminPermissions` excludes global-scoped and
 * wildcard permissions because the assign endpoint rejects them.
 *
 * Loading, failed and empty are three distinct states. A 403 gets no retry
 * button; a 403 with `STEP_UP_REQUIRED` tells the editor to re-authenticate.
 * 422 validation errors are shown inline in the modal.
 */

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import { ApiError } from '@/lib/api/client';
import {
  createCustomRole,
  listAdminPermissions,
  listCustomRoles,
  replaceCustomRolePermissions,
  updateCustomRole,
} from '@/lib/api/administration';
import type { CustomRole, Permission } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import ResourceState from '@/components/data/ResourceState';
import { formatInstant, humaniseCode } from '@/lib/api/directory';

const BASE_ROLES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'patient', label: 'Patient' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'driver', label: 'Driver' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'admin', label: 'Admin' },
];

function baseRoleLabel(baseRoleId: string): string {
  return BASE_ROLES.find((r) => r.value === baseRoleId)?.label ?? humaniseCode(baseRoleId);
}

function baseRoleTone(baseRoleId: string): BadgeTone {
  const map: Record<string, BadgeTone> = {
    admin: 'red',
    doctor: 'blue',
    pharmacy: 'teal',
    emergency: 'orange',
    driver: 'purple',
    patient: 'slate',
  };
  return map[baseRoleId] ?? 'slate';
}

type ModalKind = 'create' | 'edit' | 'permissions' | null;

export default function RolesPermissionsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const { data, isLoading, error, reload } = useApiResource(
    (signal) => listCustomRoles(signal),
    [],
  );

  const roles = useMemo(() => data?.data ?? [], [data]);

  const [searchQuery, setSearchQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (needle === '') return roles;
    return roles.filter((role) =>
      (role.display_name + ' ' + role.role_key).toLowerCase().includes(needle),
    );
  }, [roles, searchQuery]);

  // --------------------------------------------------------------- modal state

  const [modal, setModal] = useState<ModalKind>(null);
  const [activeRole, setActiveRole] = useState<CustomRole | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);

  // Create / edit form fields.
  const [roleKey, setRoleKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [baseRoleId, setBaseRoleId] = useState('doctor');
  const [active, setActive] = useState(true);

  // Permissions form: the catalogue and the currently selected set.
  const {
    data: permissionsData,
    isLoading: isPermissionsLoading,
    error: permissionsError,
    reload: reloadPermissions,
  } = useApiResource((signal) => listAdminPermissions(signal), []);

  const permissions = useMemo(() => permissionsData?.data ?? [], [permissionsData]);

  // Selected permission ids for the permissions modal. Seeded from the role.
  const [selectedPermIds, setSelectedPermIds] = useState<Set<string>>(new Set());
  const [permSearch, setPermSearch] = useState('');

  const filteredPermissions = useMemo(() => {
    const needle = permSearch.trim().toLowerCase();
    if (needle === '') return permissions;
    return permissions.filter(
      (p) =>
        p.permission_id.toLowerCase().includes(needle) ||
        (p.description ?? '').toLowerCase().includes(needle),
    );
  }, [permissions, permSearch]);

  // --------------------------------------------------------------- open helpers

  const openCreate = useCallback(() => {
    setActiveRole(null);
    setRoleKey('');
    setDisplayName('');
    setBaseRoleId('doctor');
    setActive(true);
    setWriteError(null);
    setModal('create');
  }, []);

  const openEdit = useCallback((role: CustomRole) => {
    setActiveRole(role);
    setDisplayName(role.display_name);
    setActive(role.active);
    setWriteError(null);
    setModal('edit');
  }, []);

  const openPermissions = useCallback(
    (role: CustomRole) => {
      setActiveRole(role);
      setSelectedPermIds(new Set(role.permission_ids));
      setPermSearch('');
      setWriteError(null);
      // Ensure the catalogue is fresh whenever the modal opens.
      reloadPermissions();
      setModal('permissions');
    },
    [reloadPermissions],
  );

  const closeModal = useCallback(() => {
    setModal(null);
    setActiveRole(null);
    setWriteError(null);
  }, []);

  /**
   * Every write funnels through here so conflict handling is defined in one
   * place. A 409 re-reads the list so the version in hand is never stale.
   */
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
        if (apiError.isConflict) reload();
      } finally {
        setIsSaving(false);
      }
    },
    [closeModal, reload],
  );

  // --------------------------------------------------------------- submit handlers

  const submitCreate = useCallback(() => {
    const key = roleKey.trim();
    const name = displayName.trim();
    if (key === '' || name === '') {
      setWriteError(
        new ApiError({
          status: 0,
          code: 'CLIENT_ERROR',
          title: 'Role key and display name are required',
        }),
      );
      return;
    }
    void runWrite(() =>
      createCustomRole({ role_key: key, display_name: name, base_role_id: baseRoleId as CustomRole['base_role_id'] }),
    );
  }, [roleKey, displayName, baseRoleId, runWrite]);

  const submitEdit = useCallback(() => {
    if (!activeRole) return;
    const name = displayName.trim();
    if (name === '') {
      setWriteError(
        new ApiError({
          status: 0,
          code: 'CLIENT_ERROR',
          title: 'Display name is required',
        }),
      );
      return;
    }
    void runWrite(() =>
      updateCustomRole(activeRole.custom_role_id, {
        display_name: name,
        active,
        expected_version: activeRole.version,
      }),
    );
  }, [activeRole, displayName, active, runWrite]);

  const submitPermissions = useCallback(() => {
    if (!activeRole) return;
    void runWrite(() =>
      replaceCustomRolePermissions(activeRole.custom_role_id, {
        permission_ids: Array.from(selectedPermIds),
        expected_version: activeRole.version,
      }),
    );
  }, [activeRole, selectedPermIds, runWrite]);

  const togglePermission = useCallback((permId: string, checked: boolean) => {
    setSelectedPermIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(permId);
      else next.delete(permId);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedPermIds((prev) => {
      const next = new Set(prev);
      for (const p of filteredPermissions) next.add(p.permission_id);
      return next;
    });
  }, [filteredPermissions]);

  const clearAllVisible = useCallback(() => {
    setSelectedPermIds((prev) => {
      const next = new Set(prev);
      const visibleIds = new Set(filteredPermissions.map((p) => p.permission_id));
      for (const id of next) {
        if (visibleIds.has(id)) next.delete(id);
      }
      return next;
    });
  }, [filteredPermissions]);

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Settings' }, { label: 'Roles & Permissions' }]} />

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          <PageHeader
            title="Roles & permissions"
            subtitle="Create custom roles, edit their details, and manage the permissions each role grants. Custom roles add to the base role's authority; they cannot remove it."
            actions={
              <Button onClick={openCreate} className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">add</span>
                Create Role
              </Button>
            }
          />

          <div className="relative w-full group max-w-lg">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1e3fae] transition-colors">
              <span className="material-symbols-outlined">search</span>
            </span>
            <Input
              className="pl-10"
              placeholder="Search roles by name or key"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={!isLoading && !error && filtered.length === 0}
            onRetry={reload}
            loadingLabel="Loading roles…"
            forbiddenTitle="Role access denied"
            errorTitle="Could not load roles"
            emptyTitle="No custom roles"
            emptyBody="No custom roles match this search. Create one to add authority on top of a base role."
            emptyIcon="admin_panel_settings"
          />

          {!isLoading && !error && filtered.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {filtered.map((role) => (
                <SectionCard key={role.custom_role_id}>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <h2 className="text-lg font-bold text-slate-900">{role.display_name}</h2>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <code className="text-slate-500">{role.role_key}</code>
                          <Badge tone={baseRoleTone(role.base_role_id)}>
                            {baseRoleLabel(role.base_role_id)}
                          </Badge>
                          <Badge tone={role.active ? 'green' : 'slate'}>
                            {role.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <p className="text-sm text-slate-600">
                      <span className="font-bold text-slate-900">{role.permission_ids.length}</span>{' '}
                      assigned permission{role.permission_ids.length === 1 ? '' : 's'}
                    </p>
                    <p className="text-xs text-slate-400">v{role.version} · updated {formatInstant(role.updated_at)}</p>

                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(role)}>
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openPermissions(role)}>
                        <span className="material-symbols-outlined text-[18px]">checklist</span>
                        Permissions
                      </Button>
                    </div>
                  </div>
                </SectionCard>
              ))}
            </div>
          )}
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900">
                  {modal === 'create' && 'Create custom role'}
                  {modal === 'edit' && 'Edit role'}
                  {modal === 'permissions' && 'Manage permissions'}
                </h2>
                <button
                  onClick={closeModal}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  aria-label="Close"
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
                      ? 'This role changed while you were editing'
                      : writeError.needsStepUp
                        ? 'Step-up authentication required'
                        : writeError.status === 422
                          ? 'Validation failed'
                          : writeError.isForbidden
                            ? 'You do not have permission to manage roles'
                            : writeError.title}
                  </p>
                  <p className="text-sm text-red-700 mt-1">
                    {writeError.isConflict
                      ? 'The list has been refreshed with the latest version. Reapply your change.'
                      : writeError.needsStepUp
                        ? 'Re-authenticate to obtain a step-up window, then try again.'
                        : writeError.message}
                  </p>
                </div>
              )}

              {/* Create modal */}
              {modal === 'create' && (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="role-key" className="font-semibold text-slate-900">
                      Role key
                    </Label>
                    <Input
                      id="role-key"
                      placeholder="e.g. triage_nurse"
                      value={roleKey}
                      onChange={(e) => setRoleKey(e.target.value)}
                    />
                    <p className="text-xs text-slate-500">
                      A stable identifier. Lowercase letters, numbers and underscores.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="role-name" className="font-semibold text-slate-900">
                      Display name
                    </Label>
                    <Input
                      id="role-name"
                      placeholder="e.g. Triage Nurse"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="role-base" className="font-semibold text-slate-900">
                      Base role
                    </Label>
                    <div className="relative">
                      <select
                        id="role-base"
                        className="w-full appearance-none rounded-md border border-input bg-background px-3 py-2 h-10 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none"
                        value={baseRoleId}
                        onChange={(e) => setBaseRoleId(e.target.value)}
                      >
                        {BASE_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined absolute right-3 top-2.5 text-slate-500 pointer-events-none">
                        expand_more
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      The custom role adds to this base role's authority; it cannot subtract from it.
                    </p>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" className="flex-1" onClick={closeModal}>
                      Cancel
                    </Button>
                    <Button className="flex-1" onClick={submitCreate} disabled={isSaving}>
                      {isSaving ? 'Creating…' : 'Create role'}
                    </Button>
                  </div>
                </>
              )}

              {/* Edit modal */}
              {modal === 'edit' && activeRole && (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="edit-name" className="font-semibold text-slate-900">
                      Display name
                    </Label>
                    <Input
                      id="edit-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label className="font-semibold text-slate-900">Role key</Label>
                    <Input value={activeRole.role_key} disabled className="bg-slate-50 text-slate-500" />
                    <p className="text-xs text-slate-500">The role key cannot be changed after creation.</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label className="font-semibold text-slate-900">Base role</Label>
                    <div className="flex items-center gap-2">
                      <Badge tone={baseRoleTone(activeRole.base_role_id)}>
                        {baseRoleLabel(activeRole.base_role_id)}
                      </Badge>
                      <span className="text-xs text-slate-500">Base role cannot be changed.</span>
                    </div>
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox
                      checked={active}
                      onCheckedChange={(checked) => setActive(checked === true)}
                    />
                    <span className="text-sm font-medium text-slate-900">Active</span>
                  </label>
                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" className="flex-1" onClick={closeModal}>
                      Cancel
                    </Button>
                    <Button className="flex-1" onClick={submitEdit} disabled={isSaving}>
                      {isSaving ? 'Saving…' : 'Save changes'}
                    </Button>
                  </div>
                </>
              )}

              {/* Permissions modal */}
              {modal === 'permissions' && activeRole && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-900">{activeRole.display_name}</span>
                      <span className="text-sm text-slate-500">
                        {selectedPermIds.size} of {permissions.length} permissions selected
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={selectAllVisible}>
                        Select all
                      </Button>
                      <Button variant="outline" size="sm" onClick={clearAllVisible}>
                        Clear
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500">
                    Replaces the full permission set. Only the checked permissions will be granted.
                    Global-scoped and wildcard permissions are excluded by the backend.
                  </p>

                  <div className="relative w-full group">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1e3fae] transition-colors">
                      <span className="material-symbols-outlined text-[20px]">search</span>
                    </span>
                    <Input
                      className="pl-10"
                      placeholder="Filter permissions by id or description"
                      value={permSearch}
                      onChange={(e) => setPermSearch(e.target.value)}
                    />
                  </div>

                  {isPermissionsLoading && (
                    <div className="flex flex-col items-center gap-3 py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3fae]"></div>
                      <p className="text-sm text-slate-500">Loading permission catalogue…</p>
                    </div>
                  )}

                  {!isPermissionsLoading && permissionsError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                      <p className="font-bold text-slate-900">
                        {permissionsError.isForbidden ? 'Cannot view permissions' : 'Could not load permissions'}
                      </p>
                      <p className="text-sm text-slate-600 mt-1">{permissionsError.message}</p>
                      {!permissionsError.isForbidden && (
                        <Button variant="outline" size="sm" onClick={reloadPermissions} className="mt-3">
                          Try again
                        </Button>
                      )}
                    </div>
                  )}

                  {!isPermissionsLoading && !permissionsError && filteredPermissions.length === 0 && (
                    <div className="py-8 text-center">
                      <p className="text-sm text-slate-500">
                        {permissions.length === 0
                          ? 'No assignable permissions are available.'
                          : 'No permissions match your filter.'}
                      </p>
                    </div>
                  )}

                  {!isPermissionsLoading && !permissionsError && filteredPermissions.length > 0 && (
                    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-96 overflow-y-auto">
                      {filteredPermissions.map((perm: Permission) => (
                        <label
                          key={perm.permission_id}
                          className="flex items-start gap-3 p-3 hover:bg-slate-50 cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedPermIds.has(perm.permission_id)}
                            onCheckedChange={(checked) =>
                              togglePermission(perm.permission_id, checked === true)
                            }
                            className="mt-0.5"
                          />
                          <div className="flex flex-col gap-0.5">
                            <code className="text-xs text-slate-700">{perm.permission_id}</code>
                            <span className="text-sm text-slate-500">
                              {perm.description ?? 'No description available.'}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" className="flex-1" onClick={closeModal}>
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={submitPermissions}
                      disabled={isSaving || isPermissionsLoading}
                    >
                      {isSaving ? 'Saving…' : 'Save permissions'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
