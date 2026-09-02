/**
 * Modern RBAC Utilities
 * Core functions for role-based access control with pattern matching
 */

import { Permission, PERMISSIONS, permission as permissionBuilder } from './permissions';
import { RoleId, getRole, roleHasPermission } from './roles';
import { PORTAL_TO_BACKEND_PERMISSIONS } from './permission-mapping';

// Re-export everything
export * from './permissions';
export * from './roles';
export * from './menu-config';

/**
 * Check if user has a specific permission
 * Supports wildcards and pattern matching
 */
export function hasPermission(
  userPermissions: Permission[],
  requiredPermission: Permission
): boolean {
  // Wildcard permission grants all access
  if (userPermissions.includes(PERMISSIONS.ALL)) {
    return true;
  }

  // Check for exact match
  if (userPermissions.includes(requiredPermission)) {
    return true;
  }

  // Check for pattern matches using permission builder
  for (const userPerm of userPermissions) {
    if (permissionBuilder.matches(userPerm, requiredPermission)) {
      return true;
    }
  }

  // Bridge the portal vocabulary to the backend's permission vocabulary. The
  // menu config and route guards use portal-local names; the backend session
  // returns backend names. The mapping names every backend permission that
  // satisfies a given portal permission.
  const backendPerms = PORTAL_TO_BACKEND_PERMISSIONS[requiredPermission];
  if (backendPerms !== undefined) {
    for (const backendPerm of backendPerms) {
      if (userPermissions.includes(backendPerm)) return true;
    }
  }

  return false;
}

/**
 * Check if user has any of the required permissions
 */
export function hasAnyPermission(
  userPermissions: Permission[],
  requiredPermissions: Permission[]
): boolean {
  // Wildcard permission grants all access
  if (userPermissions.includes(PERMISSIONS.ALL)) {
    return true;
  }
  
  return requiredPermissions.some(permission => 
    hasPermission(userPermissions, permission)
  );
}

/**
 * Check if user has all required permissions
 */
export function hasAllPermissions(
  userPermissions: Permission[],
  requiredPermissions: Permission[]
): boolean {
  // Wildcard permission grants all access
  if (userPermissions.includes(PERMISSIONS.ALL)) {
    return true;
  }
  
  return requiredPermissions.every(permission => 
    hasPermission(userPermissions, permission)
  );
}

/**
 * Get permissions for a role
 */
export function getPermissionsForRole(roleId: RoleId): Permission[] {
  const role = getRole(roleId);
  return role?.permissions || [];
}

/**
 * Filter items based on required permission
 */
export function filterByPermission<T extends { requiredPermission?: Permission }>(
  items: T[],
  userPermissions: Permission[]
): T[] {
  return items.filter(item => {
    // No permission required - always show
    if (!item.requiredPermission) return true;
    
    // Check if user has the required permission
    return hasPermission(userPermissions, item.requiredPermission);
  });
}

/**
 * Filter items based on multiple possible permissions (OR logic)
 */
export function filterByAnyPermission<T extends { requiredPermissions?: Permission[] }>(
  items: T[],
  userPermissions: Permission[]
): T[] {
  return items.filter(item => {
    // No permissions required - always show
    if (!item.requiredPermissions || item.requiredPermissions.length === 0) {
      return true;
    }
    
    // Check if user has any of the required permissions
    return hasAnyPermission(userPermissions, item.requiredPermissions);
  });
}

/**
 * Modern route permission mapping
 * Maps routes to required permissions using resource:action pattern
 */
const ROUTE_PERMISSIONS: Record<string, Permission> = {
  // Dashboard
  '/dashboard': PERMISSIONS.DASHBOARD_VIEW,
  
  // Users
  '/users/patients': PERMISSIONS.USER_READ,
  '/users/doctors': PERMISSIONS.DOCTOR_READ,
  '/users/verification': PERMISSIONS.DOCTOR_VERIFY,
  
  // Appointments
  '/appointments': PERMISSIONS.APPOINTMENT_READ,
  
  // Finance
  '/finance': PERMISSIONS.FINANCE_READ,
  '/finance/transactions': PERMISSIONS.FINANCE_TRANSACTION_READ,
  '/finance/payouts': PERMISSIONS.FINANCE_PAYOUT_READ,
  
  // Support
  '/support': PERMISSIONS.SUPPORT_READ,
  
  // Content
  '/content': PERMISSIONS.CONTENT_READ,
  '/content/faq': PERMISSIONS.CONTENT_READ,
  '/content/notifications': PERMISSIONS.CONTENT_UPDATE,
  
  // System
  '/system': PERMISSIONS.SYSTEM_READ,
  '/system/settings': PERMISSIONS.SYSTEM_UPDATE,
  '/system/admins': PERMISSIONS.SYSTEM_ADMIN_MANAGE,
  '/system/roles': PERMISSIONS.SYSTEM_ROLE_MANAGE,
  '/system/audit': PERMISSIONS.SYSTEM_AUDIT_READ,
  '/system/analytics': PERMISSIONS.ANALYTICS_READ,
  
  // Pharmacy
  '/pharmacy': PERMISSIONS.PHARMACY_READ,
  '/pharmacy/medications': PERMISSIONS.PHARMACY_READ,

  // Settings (admin tools)
  '/settings/exports': PERMISSIONS.EXPORT_REQUEST,
  '/settings/firmware': PERMISSIONS.IOT_FIRMWARE_MANAGE,

  // Emergency
  '/emergency': PERMISSIONS.EMERGENCY_READ,

  // Devices (Admin)
  '/devices': PERMISSIONS.IOT_DEVICE_MANAGE,

  // Doctor Routes
  '/doctor/dashboard': PERMISSIONS.DASHBOARD_VIEW,
  '/doctor/patients': PERMISSIONS.PATIENT_READ_ASSIGNED,
  '/doctor/schedule': PERMISSIONS.APPOINTMENT_READ_OWN,
  '/doctor/appointments': PERMISSIONS.APPOINTMENT_READ_OWN,
  '/doctor/notes': PERMISSIONS.CLINICAL_NOTE_READ,
  '/doctor/prescriptions': PERMISSIONS.PRESCRIPTION_READ,
  '/doctor/templates': PERMISSIONS.TEMPLATE_READ,
  '/doctor/iot/patients': PERMISSIONS.IOT_DEVICE_READ,
  '/doctor/iot/history': PERMISSIONS.IOT_HISTORY_READ,
  '/doctor/ai/assistant': PERMISSIONS.AI_ASSISTANT_USE,
  '/doctor/ai/artifacts': PERMISSIONS.AI_ASSISTANT_USE,
  '/doctor/earnings': PERMISSIONS.EARNING_READ_OWN,
  '/doctor/analytics': PERMISSIONS.ANALYTICS_READ_OWN,
  '/doctor/inbox': PERMISSIONS.CLINICAL_NOTE_READ,
  '/doctor/profile': PERMISSIONS.PROFILE_READ,
  
  // Profile (accessible to all authenticated users)
  '/profile': PERMISSIONS.PROFILE_READ,
};

/**
 * Check if route is accessible by user
 * Modern approach with pattern matching
 */
export function canAccessRoute(
  route: string,
  userRole: RoleId,
  userPermissions: Permission[]
): boolean {
  // Super admin can access everything
  if (userPermissions.includes(PERMISSIONS.ALL)) {
    return true;
  }
  
  // Public routes (no authentication required)
  const publicRoutes = ['/login', '/2fa', '/role-select', '/forgot-password'];
  if (publicRoutes.some(publicRoute => route.startsWith(publicRoute))) {
    return true;
  }
  
  // Find exact match first
  if (ROUTE_PERMISSIONS[route]) {
    return hasPermission(userPermissions, ROUTE_PERMISSIONS[route]);
  }
  
  // Find prefix match (e.g., "/users/patients/123" matches "/users/patients")
  for (const [routePath, permission] of Object.entries(ROUTE_PERMISSIONS)) {
    if (route.startsWith(routePath)) {
      return hasPermission(userPermissions, permission);
    }
  }
  
  // Default: deny access to unknown routes
  return false;
}

/**
 * Get required permission for a route
 */
export function getRoutePermission(route: string): Permission | null {
  // Exact match
  if (ROUTE_PERMISSIONS[route]) {
    return ROUTE_PERMISSIONS[route];
  }
  
  // Prefix match
  for (const [routePath, permission] of Object.entries(ROUTE_PERMISSIONS)) {
    if (route.startsWith(routePath)) {
      return permission;
    }
  }
  
  return null;
}

/**
 * Get accessible routes for a user
 */
export function getAccessibleRoutes(
  userRole: RoleId,
  userPermissions: Permission[]
): string[] {
  return Object.keys(ROUTE_PERMISSIONS).filter(route =>
    canAccessRoute(route, userRole, userPermissions)
  );
}

/**
 * Check if user can perform action on resource
 * Modern resource:action pattern
 */
export function canPerformAction(
  userPermissions: Permission[],
  resource: string,
  action: string,
  scope?: string
): boolean {
  const requiredPermission = scope
    ? `${resource}:${action}:${scope}`
    : `${resource}:${action}`;
  
  return hasPermission(userPermissions, requiredPermission as Permission);
}

/**
 * Get user's effective permissions (for debugging/display)
 */
export function getEffectivePermissions(
  userRole: RoleId,
  userPermissions: Permission[]
): {
  role: string;
  permissionCount: number;
  hasWildcard: boolean;
  permissions: Permission[];
} {
  const role = getRole(userRole);
  const hasWildcard = userPermissions.includes(PERMISSIONS.ALL);
  
  return {
    role: role?.name || 'Unknown',
    permissionCount: hasWildcard ? Infinity : userPermissions.length,
    hasWildcard,
    permissions: userPermissions,
  };
}

/**
 * Permission check result with reason (for debugging)
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  requiredPermission?: Permission;
  matchedPermission?: Permission;
}

/**
 * Check permission with detailed result
 */
export function checkPermissionDetailed(
  userPermissions: Permission[],
  requiredPermission: Permission
): PermissionCheckResult {
  // Wildcard check
  if (userPermissions.includes(PERMISSIONS.ALL)) {
    return {
      allowed: true,
      reason: 'User has wildcard permission (*)',
      requiredPermission,
      matchedPermission: PERMISSIONS.ALL,
    };
  }
  
  // Exact match
  if (userPermissions.includes(requiredPermission)) {
    return {
      allowed: true,
      reason: 'Exact permission match',
      requiredPermission,
      matchedPermission: requiredPermission,
    };
  }
  
  // Pattern match
  for (const userPerm of userPermissions) {
    if (permissionBuilder.matches(userPerm, requiredPermission)) {
      return {
        allowed: true,
        reason: 'Pattern match',
        requiredPermission,
        matchedPermission: userPerm,
      };
    }
  }
  
  // No match
  return {
    allowed: false,
    reason: 'No matching permission found',
    requiredPermission,
  };
}

/**
 * Validate permission string format
 */
export function isValidPermission(permission: string): boolean {
  // Must follow resource:action or resource:action:scope pattern
  const parts = permission.split(':');
  
  if (parts.length < 2 || parts.length > 3) {
    return false;
  }
  
  // Check for wildcards
  if (permission === '*') return true;
  
  // Each part must be non-empty
  return parts.every(part => part.length > 0);
}
