/**
 * Modern RBAC Role Definitions
 * Uses resource:action pattern with permission groups
 */

import { PERMISSIONS, PERMISSION_GROUPS, Permission } from './permissions';
import type { RoleId as BackendRoleId } from '@/types/session';

/** Portal role ids are the backend canonical ids (`super_admin`, not `super-admin`). */
export type RoleId = BackendRoleId;

export interface Role {
  id: RoleId;
  name: string;
  description: string;
  permissions: Permission[];
  dashboardRoute: string;
  color: string; // For UI badges
  icon: string; // Material icon name
}

/**
 * Modern Role Definitions with Permission Groups
 */
export const ROLES: Record<RoleId, Role> = {
  'super_admin': {
    id: 'super_admin',
    name: 'Super Admin',
    description: 'Full system access with all permissions',
    permissions: [PERMISSIONS.ALL], // Wildcard - grants everything
    dashboardRoute: '/dashboard',
    color: '#dc2626', // red-600
    icon: 'admin_panel_settings',
  },
  
  'admin': {
    id: 'admin',
    name: 'Admin',
    description: 'Standard administrator with most features except system configuration',
    permissions: [
      // Dashboard
      PERMISSIONS.DASHBOARD_VIEW,
      
      // User Management (manage, not full)
      ...PERMISSION_GROUPS.USER_MANAGE,
      PERMISSIONS.USER_EXPORT,
      
      // Doctor Management (manage, not full)
      ...PERMISSION_GROUPS.DOCTOR_MANAGE,
      
      // Appointment Management (full)
      ...PERMISSION_GROUPS.APPOINTMENT_MANAGE,
      PERMISSIONS.APPOINTMENT_EXPORT,
      
      // Finance (view only, NO payout processing)
      PERMISSIONS.FINANCE_READ,
      PERMISSIONS.FINANCE_TRANSACTION_READ,
      // NO: FINANCE_PAYOUT_PROCESS
      
      // Support (full)
      PERMISSIONS.SUPPORT_READ,
      PERMISSIONS.SUPPORT_RESPOND,
      PERMISSIONS.SUPPORT_CLOSE,
      PERMISSIONS.SUPPORT_ASSIGN,
      
      // Content (full)
      PERMISSIONS.CONTENT_READ,
      PERMISSIONS.CONTENT_CREATE,
      PERMISSIONS.CONTENT_UPDATE,
      PERMISSIONS.CONTENT_PUBLISH,
      
      // Emergency (admin level - includes management functions)
      ...PERMISSION_GROUPS.EMERGENCY_ADMIN,

      // IoT device management (admin registers and assigns org-wide)
      PERMISSIONS.IOT_DEVICE_MANAGE,

      // NO System permissions
      // NO Pharmacy permissions

      // Profile
      PERMISSIONS.PROFILE_READ,
      PERMISSIONS.PROFILE_UPDATE,
    ],
    dashboardRoute: '/dashboard',
    color: '#2563eb', // blue-600
    icon: 'person',
  },
  
  'pharmacy': {
    id: 'pharmacy',
    name: 'Pharmacy Manager',
    description: 'Manages prescription orders and pharmacy operations',
    permissions: [
      // NO Dashboard permission - pharmacy users go directly to pharmacy operations
      
      // Pharmacy (full access)
      PERMISSIONS.PHARMACY_READ,
      PERMISSIONS.PHARMACY_ORDER_READ,
      PERMISSIONS.PHARMACY_ORDER_UPDATE,
      PERMISSIONS.PHARMACY_ORDER_DISPATCH,
      PERMISSIONS.PHARMACY_VALIDATION_READ,
      PERMISSIONS.PHARMACY_VALIDATION_APPROVE,
      PERMISSIONS.PHARMACY_FULFILLMENT_READ,
      PERMISSIONS.PHARMACY_FULFILLMENT_UPDATE,
      PERMISSIONS.PHARMACY_LOGISTICS_READ,
      PERMISSIONS.PHARMACY_LOGISTICS_ASSIGN,
      PERMISSIONS.PHARMACY_INVENTORY_READ,
      PERMISSIONS.PHARMACY_CONTROLLED_READ,
      PERMISSIONS.PHARMACY_RETURNS_READ,
      PERMISSIONS.PHARMACY_PROCUREMENT_READ,
      PERMISSIONS.PHARMACY_ANALYTICS_READ,
      PERMISSIONS.PHARMACY_INTAKE_CREATE,
      PERMISSIONS.PHARMACY_RECONCILIATION_READ,
      
      // Profile
      PERMISSIONS.PROFILE_READ,
      PERMISSIONS.PROFILE_UPDATE,
    ],
    dashboardRoute: '/pharmacy/dashboard',
    color: '#059669', // green-600
    icon: 'local_pharmacy',
  },
  
  'emergency': {
    id: 'emergency',
    name: 'Emergency Operator',
    description: 'Handles emergency SOS calls and dispatches ambulances',
    permissions: [
      // Dashboard (limited)
      PERMISSIONS.DASHBOARD_VIEW,
      
      // Emergency Operations (operator level - NO management functions)
      ...PERMISSION_GROUPS.EMERGENCY_OPERATOR,

      // Break-glass: activate an emergency PHI disclosure grant
      PERMISSIONS.BREAK_GLASS_ACTIVATE,

      // Profile
      PERMISSIONS.PROFILE_READ,
      PERMISSIONS.PROFILE_UPDATE,
    ],
    dashboardRoute: '/emergency',
    color: '#dc2626', // red-600
    icon: 'emergency',
  },
  
  'doctor': {
    id: 'doctor',
    name: 'Doctor',
    description: 'Healthcare provider with patient care and clinical access',
    permissions: [
      // Dashboard
      PERMISSIONS.DASHBOARD_VIEW,
      
      // Clinical (full) - Uses permission group
      ...PERMISSION_GROUPS.CLINICAL_FULL,
      
      // Appointments (own only)
      PERMISSIONS.APPOINTMENT_READ_OWN,
      PERMISSIONS.APPOINTMENT_UPDATE,
      PERMISSIONS.APPOINTMENT_CANCEL,
      
      // IoT & AI (full) - Uses permission group
      ...PERMISSION_GROUPS.IOT_AI_FULL,

      // Doctor may assign available devices to their own patients
      PERMISSIONS.IOT_DEVICE_ASSIGN,

      // Earnings (own only)
      PERMISSIONS.EARNING_READ_OWN,
      PERMISSIONS.EARNING_EXPORT_OWN,
      
      // Analytics (own only)
      PERMISSIONS.ANALYTICS_READ_OWN,
      
      // Profile
      PERMISSIONS.PROFILE_READ,
      PERMISSIONS.PROFILE_UPDATE,
    ],
    dashboardRoute: '/doctor/dashboard',
    color: '#7c3aed', // violet-600
    icon: 'medical_services',
  },

  'patient': {
    id: 'patient',
    name: 'Patient',
    description: 'Patient membership',
    permissions: [],
    dashboardRoute: '/dashboard',
    color: '#0891b2',
    icon: 'personal_injury',
  },

  'driver': {
    id: 'driver',
    name: 'Driver',
    description: 'Medical transport driver membership',
    permissions: [],
    dashboardRoute: '/dashboard',
    color: '#d97706',
    icon: 'ambulance',
  },
};

/**
 * Get role by ID
 */
export function getRole(roleId: RoleId): Role | undefined {
  return ROLES[roleId];
}

/**
 * Get all available roles
 */
export function getAllRoles(): Role[] {
  return Object.values(ROLES);
}

/**
 * Get roles available for selection (excludes super-admin from UI)
 */
export function getSelectableRoles(): Role[] {
  return Object.values(ROLES).filter(role => role.id !== 'super_admin');
}

/**
 * Check if a role has a specific permission
 * Modern approach with wildcard and pattern matching support
 */
export function roleHasPermission(roleId: RoleId, permission: Permission): boolean {
  const role = getRole(roleId);
  if (!role) return false;
  
  // Check for wildcard permission (super-admin)
  if (role.permissions.includes(PERMISSIONS.ALL)) return true;
  
  // Check for exact match
  if (role.permissions.includes(permission)) return true;
  
  // Check for wildcard patterns (e.g., "user:*" matches "user:read")
  const [reqResource, reqAction, reqScope] = permission.split(':');
  
  for (const userPerm of role.permissions) {
    const [userResource, userAction, userScope] = userPerm.split(':');
    
    // Resource wildcard (e.g., "user:*" matches "user:read")
    if (userResource === reqResource && userAction === '*') return true;
    
    // Action wildcard (e.g., "*:read" matches "user:read")
    if (userResource === '*' && userAction === reqAction) return true;
    
    // Scope matching (e.g., "user:read:own" matches "user:read:own")
    if (userResource === reqResource && userAction === reqAction && userScope === reqScope) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if role has any of the required permissions
 */
export function roleHasAnyPermission(roleId: RoleId, permissions: Permission[]): boolean {
  return permissions.some(permission => roleHasPermission(roleId, permission));
}

/**
 * Check if role has all required permissions
 */
export function roleHasAllPermissions(roleId: RoleId, permissions: Permission[]): boolean {
  return permissions.every(permission => roleHasPermission(roleId, permission));
}

/**
 * Get permission count for a role (for display purposes)
 */
export function getRolePermissionCount(roleId: RoleId): number {
  const role = getRole(roleId);
  if (!role) return 0;
  
  // Wildcard means unlimited
  if (role.permissions.includes(PERMISSIONS.ALL)) return Infinity;
  
  return role.permissions.length;
}

/**
 * Compare roles by permission level (for sorting)
 */
export function compareRolesByLevel(roleA: RoleId, roleB: RoleId): number {
  const countA = getRolePermissionCount(roleA);
  const countB = getRolePermissionCount(roleB);
  
  // Infinity (super-admin) always comes first
  if (countA === Infinity) return -1;
  if (countB === Infinity) return 1;
  
  return countB - countA; // Descending order
}

/**
 * Role hierarchy for permission inheritance (future use)
 */
export const ROLE_HIERARCHY: Record<RoleId, RoleId[]> = {
  'super_admin': [], // Top level, no parents
  'admin': ['super_admin'], // Inherits from super-admin
  'pharmacy': [], // Independent
  'emergency': [], // Independent
  'doctor': [], // Independent
  'patient': [], // Independent
  'driver': [], // Independent
};

/**
 * Check if roleA can manage roleB (for admin user management)
 */
export function canManageRole(managerRole: RoleId, targetRole: RoleId): boolean {
  // Super admin can manage everyone
  if (managerRole === 'super_admin') return true;
  
  // Admin can manage pharmacy, emergency, and doctor (but not super-admin or other admins)
  if (managerRole === 'admin') {
    return ['pharmacy', 'emergency', 'doctor'].includes(targetRole);
  }
  
  // Other roles cannot manage anyone
  return false;
}

/**
 * Get role display info for UI
 */
export function getRoleDisplayInfo(roleId: RoleId): {
  name: string;
  color: string;
  icon: string;
  badge: string;
} {
  const role = getRole(roleId);
  if (!role) {
    return {
      name: 'Unknown',
      color: '#6b7280',
      icon: 'help',
      badge: 'bg-gray-100 text-gray-700',
    };
  }
  
  // Generate Tailwind badge classes
  const badgeColors: Record<RoleId, string> = {
    'super_admin': 'bg-red-100 text-red-700',
    'admin': 'bg-blue-100 text-blue-700',
    'pharmacy': 'bg-green-100 text-green-700',
    'emergency': 'bg-red-100 text-red-700',
    'doctor': 'bg-violet-100 text-violet-700',
    'patient': 'bg-cyan-100 text-cyan-700',
    'driver': 'bg-amber-100 text-amber-700',
  };
  
  return {
    name: role.name,
    color: role.color,
    icon: role.icon,
    badge: badgeColors[roleId],
  };
}
