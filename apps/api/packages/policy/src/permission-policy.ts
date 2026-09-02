export type PermissionScope = 'own' | 'assigned' | 'site' | 'organization' | 'global';

export interface ParsedPermission {
  readonly resource: string;
  readonly action: string;
  readonly scope: PermissionScope | null;
  readonly canonical: string;
}

export interface ObjectPolicyContext {
  readonly actorProfileId: string;
  readonly ownerProfileId?: string;
  readonly assigned?: boolean;
  readonly resourceSiteId?: string;
  readonly membershipSiteIds?: ReadonlySet<string>;
  readonly resourceOrganizationId?: string;
  readonly membershipOrganizationId?: string;
  readonly globalAllowed?: boolean;
  readonly unscopedObjectPolicyAllowed?: boolean;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason: 'allowed' | 'permission_missing' | 'object_policy_denied' | 'invalid_permission';
  readonly matchedPermission: string | null;
}

const permissionPattern = /^([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*):([a-z*][a-z0-9_*]*)(?::(own|assigned|site|organization|global))?$/;

export function parsePermission(value: string): ParsedPermission | undefined {
  const match = permissionPattern.exec(value);
  if (match === null) return undefined;
  return Object.freeze({
    resource: match[1]!,
    action: match[2]!,
    scope: (match[3] as PermissionScope | undefined) ?? null,
    canonical: value,
  });
}

export function evaluatePermission(
  grantedPermissions: readonly string[],
  requiredPermission: string,
  context: ObjectPolicyContext,
): PolicyDecision {
  const required = parsePermission(requiredPermission);
  if (required === undefined) return decision(false, 'invalid_permission', null);

  for (const grantValue of grantedPermissions) {
    const grant = parsePermission(grantValue);
    if (grant === undefined || !permissionMatches(grant, required)) continue;
    if (scopeAllows(required.scope, context)) {
      return decision(true, 'allowed', grant.canonical);
    }
    return decision(false, 'object_policy_denied', grant.canonical);
  }
  return decision(false, 'permission_missing', null);
}

function permissionMatches(grant: ParsedPermission, required: ParsedPermission): boolean {
  return grant.resource === required.resource &&
    (grant.action === required.action || grant.action === '*') &&
    grant.scope === required.scope;
}

function scopeAllows(scope: PermissionScope | null, context: ObjectPolicyContext): boolean {
  switch (scope) {
    case null: return context.unscopedObjectPolicyAllowed === true;
    case 'own': return context.ownerProfileId !== undefined &&
      context.ownerProfileId === context.actorProfileId;
    case 'assigned': return context.assigned === true;
    case 'site': return context.resourceSiteId !== undefined &&
      context.membershipSiteIds?.has(context.resourceSiteId) === true;
    case 'organization': return context.resourceOrganizationId !== undefined &&
      context.resourceOrganizationId === context.membershipOrganizationId;
    case 'global': return context.globalAllowed === true;
  }
}

function decision(
  allowed: boolean,
  reason: PolicyDecision['reason'],
  matchedPermission: string | null,
): PolicyDecision {
  return Object.freeze({ allowed, reason, matchedPermission });
}
