/**
 * Modern RBAC Permission Definitions
 * Using Resource:Action pattern for better scalability and clarity
 * 
 * Pattern: resource:action or resource:action:scope
 * Examples:
 *   - user:read (read any user)
 *   - user:read:own (read own user only)
 *   - appointment:create:assigned (create appointments for assigned patients)
 */

// Permission type with resource:action pattern
export type Permission = string;

/**
 * Permission Builder - Modern approach for creating permissions
 */
export const permission = {
  // Helper to create permission string
  create: (resource: string, action: string, scope?: string): Permission => {
    return scope ? `${resource}:${action}:${scope}` : `${resource}:${action}`;
  },
  
  // Check if permission matches pattern (supports wildcards)
  matches: (userPermission: Permission, requiredPermission: Permission): boolean => {
    // Wildcard permission
    if (userPermission === '*') return true;

    // Exact match
    if (userPermission === requiredPermission) return true;

    // Wildcard resource (e.g., "user:*" matches "user:read", "user:write")
    const [userResource, userAction, userScope] = userPermission.split(':');
    const [reqResource, reqAction, reqScope] = requiredPermission.split(':');

    // A scoped user permission satisfies the unscoped form (e.g.,
    // `appointment:read:organization` grants `appointment:read`). The reverse does
    // not hold: holding `appointment:read` does NOT grant `appointment:read:org`,
    // because a scope names a subset the caller has been authorised for.
    if (userResource === reqResource && userAction === reqAction && userScope !== undefined && reqScope === undefined) return true;
    if (userResource === reqResource && userAction === '*') return true;
    if (userResource === '*' && userAction === reqAction) return true;

    return false;
  },
};

/**
 * Core Permissions - Using modern resource:action pattern
 */
export const PERMISSIONS = {
  // Wildcard
  ALL: '*' as Permission,
  
  // Dashboard
  DASHBOARD_VIEW: 'dashboard:read' as Permission,
  
  // Users (Patients) - Modern pattern
  USER_READ: 'user:read' as Permission,
  USER_CREATE: 'user:create' as Permission,
  USER_UPDATE: 'user:update' as Permission,
  USER_DELETE: 'user:delete' as Permission,
  USER_SUSPEND: 'user:suspend' as Permission,
  USER_EXPORT: 'user:export' as Permission,
  
  // Doctors - Modern pattern
  DOCTOR_READ: 'doctor:read' as Permission,
  DOCTOR_CREATE: 'doctor:create' as Permission,
  DOCTOR_UPDATE: 'doctor:update' as Permission,
  DOCTOR_DELETE: 'doctor:delete' as Permission,
  DOCTOR_VERIFY: 'doctor:verify' as Permission,
  DOCTOR_SUSPEND: 'doctor:suspend' as Permission,
  
  // Appointments - Modern pattern
  APPOINTMENT_READ: 'appointment:read' as Permission,
  APPOINTMENT_READ_OWN: 'appointment:read:own' as Permission, // Doctor reads own appointments
  APPOINTMENT_CREATE: 'appointment:create' as Permission,
  APPOINTMENT_UPDATE: 'appointment:update' as Permission,
  APPOINTMENT_DELETE: 'appointment:delete' as Permission,
  APPOINTMENT_CANCEL: 'appointment:cancel' as Permission,
  APPOINTMENT_EXPORT: 'appointment:export' as Permission,
  
  // Finance - Modern pattern
  FINANCE_READ: 'finance:read' as Permission,
  FINANCE_TRANSACTION_READ: 'finance:transaction:read' as Permission,
  FINANCE_PAYOUT_READ: 'finance:payout:read' as Permission,
  FINANCE_PAYOUT_PROCESS: 'finance:payout:process' as Permission,
  FINANCE_EXPORT: 'finance:export' as Permission,
  
  // Support - Modern pattern
  SUPPORT_READ: 'support:read' as Permission,
  SUPPORT_CREATE: 'support:create' as Permission,
  SUPPORT_UPDATE: 'support:update' as Permission,
  SUPPORT_RESPOND: 'support:respond' as Permission,
  SUPPORT_CLOSE: 'support:close' as Permission,
  SUPPORT_ASSIGN: 'support:assign' as Permission,
  
  // Content - Modern pattern
  CONTENT_READ: 'content:read' as Permission,
  CONTENT_CREATE: 'content:create' as Permission,
  CONTENT_UPDATE: 'content:update' as Permission,
  CONTENT_DELETE: 'content:delete' as Permission,
  CONTENT_PUBLISH: 'content:publish' as Permission,
  
  // System - Modern pattern
  SYSTEM_READ: 'system:read' as Permission,
  SYSTEM_UPDATE: 'system:update' as Permission,
  SYSTEM_ADMIN_MANAGE: 'system:admin:manage' as Permission,
  SYSTEM_ROLE_MANAGE: 'system:role:manage' as Permission,
  SYSTEM_AUDIT_READ: 'system:audit:read' as Permission,
  
  // Pharmacy - Modern pattern
  PHARMACY_READ: 'pharmacy:read' as Permission,
  PHARMACY_ORDER_READ: 'pharmacy:order:read' as Permission,
  PHARMACY_ORDER_UPDATE: 'pharmacy:order:update' as Permission,
  PHARMACY_ORDER_DISPATCH: 'pharmacy:order:dispatch' as Permission,
  PHARMACY_VALIDATION_READ: 'pharmacy:validation:read' as Permission,
  PHARMACY_VALIDATION_APPROVE: 'pharmacy:validation:approve' as Permission,
  PHARMACY_FULFILLMENT_READ: 'pharmacy:fulfillment:read' as Permission,
  PHARMACY_FULFILLMENT_UPDATE: 'pharmacy:fulfillment:update' as Permission,
  PHARMACY_LOGISTICS_READ: 'pharmacy:logistics:read' as Permission,
  PHARMACY_LOGISTICS_ASSIGN: 'pharmacy:logistics:assign' as Permission,
  PHARMACY_INVENTORY_READ: 'pharmacy:inventory:read' as Permission,
  PHARMACY_CONTROLLED_READ: 'pharmacy:controlled:read' as Permission,
  PHARMACY_RETURNS_READ: 'pharmacy:returns:read' as Permission,
  PHARMACY_PROCUREMENT_READ: 'pharmacy:procurement:read' as Permission,
  PHARMACY_ANALYTICS_READ: 'pharmacy:analytics:read' as Permission,
  PHARMACY_INTAKE_CREATE: 'pharmacy:intake:create' as Permission,
  PHARMACY_RECONCILIATION_READ: 'pharmacy:reconciliation:read' as Permission,
  
  // Emergency - Modern pattern with granular permissions
  EMERGENCY_READ: 'emergency:read' as Permission,                     // View emergency dashboard
  EMERGENCY_DISPATCH: 'emergency:dispatch' as Permission,             // Dispatch ambulances
  EMERGENCY_LOG_READ: 'emergency:log:read' as Permission,             // View SOS logs
  EMERGENCY_RESPOND: 'emergency:respond' as Permission,               // Respond to emergencies
  EMERGENCY_COMMUNICATE: 'emergency:communicate' as Permission,       // Access communications center
  EMERGENCY_FLEET_READ: 'emergency:fleet:read' as Permission,         // View fleet status
  EMERGENCY_MAP_READ: 'emergency:map:read' as Permission,             // View response map
  EMERGENCY_TRIAGE_READ: 'emergency:triage:read' as Permission,       // View triage queue
  
  // Emergency Management (Admin only)
  EMERGENCY_PERSONNEL_MANAGE: 'emergency:personnel:manage' as Permission,  // Manage staff
  EMERGENCY_ANALYTICS_READ: 'emergency:analytics:read' as Permission,      // View analytics
  EMERGENCY_SETTINGS_UPDATE: 'emergency:settings:update' as Permission,    // Update system settings

  // Break-glass — emergency PHI disclosure without prior consent
  BREAK_GLASS_ACTIVATE: 'break_glass:activate' as Permission,
  
  // Doctor Clinical - Modern pattern with scope
  PATIENT_READ_ASSIGNED: 'patient:read:assigned' as Permission, // Doctor reads assigned patients
  PATIENT_HISTORY_READ: 'patient:history:read' as Permission,
  PATIENT_LAB_READ: 'patient:lab:read' as Permission,
  
  CLINICAL_NOTE_READ: 'clinical:note:read' as Permission,
  CLINICAL_NOTE_CREATE: 'clinical:note:create' as Permission,
  CLINICAL_NOTE_UPDATE: 'clinical:note:update' as Permission,
  
  PRESCRIPTION_READ: 'prescription:read' as Permission,
  PRESCRIPTION_CREATE: 'prescription:create' as Permission,
  PRESCRIPTION_UPDATE: 'prescription:update' as Permission,
  
  TEMPLATE_READ: 'template:read' as Permission,
  TEMPLATE_CREATE: 'template:create' as Permission,
  TEMPLATE_UPDATE: 'template:update' as Permission,
  TEMPLATE_DELETE: 'template:delete' as Permission,
  
  // IoT - Modern pattern
  IOT_READ: 'iot:read' as Permission,
  IOT_DEVICE_READ: 'iot:device:read' as Permission,
  IOT_HISTORY_READ: 'iot:history:read' as Permission,
  IOT_ALERT_READ: 'iot:alert:read' as Permission,
  IOT_DEVICE_MANAGE: 'iot:device:manage' as Permission,
  IOT_DEVICE_ASSIGN: 'iot:device:assign' as Permission,
  IOT_FIRMWARE_MANAGE: 'iot:firmware:manage' as Permission,

  // AI - Modern pattern
  AI_ASSISTANT_USE: 'ai:assistant:use' as Permission,
  AI_DIAGNOSIS_READ: 'ai:diagnosis:read' as Permission,
  AI_DIAGNOSIS_APPROVE: 'ai:diagnosis:approve' as Permission,
  AI_TREATMENT_READ: 'ai:treatment:read' as Permission,
  
  // Earnings - Modern pattern
  EARNING_READ_OWN: 'earning:read:own' as Permission, // Doctor reads own earnings
  EARNING_EXPORT_OWN: 'earning:export:own' as Permission,
  
  // Analytics - Modern pattern
  ANALYTICS_READ: 'analytics:read' as Permission,
  ANALYTICS_READ_OWN: 'analytics:read:own' as Permission, // Doctor reads own analytics
  
  // Profile - Modern pattern
  PROFILE_READ: 'profile:read' as Permission,
  PROFILE_UPDATE: 'profile:update' as Permission,

  // Data export — bulk disclosure, admin only
  EXPORT_REQUEST: 'export:request' as Permission,
} as const;

// Export Permission type from PERMISSIONS
export type PermissionType = typeof PERMISSIONS[keyof typeof PERMISSIONS];

/**
 * Permission Groups - For easier role assignment
 */
export const PERMISSION_GROUPS = {
  // User Management
  USER_FULL: [
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.USER_DELETE,
    PERMISSIONS.USER_SUSPEND,
    PERMISSIONS.USER_EXPORT,
  ],
  USER_MANAGE: [
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.USER_SUSPEND,
  ],
  USER_VIEW: [
    PERMISSIONS.USER_READ,
  ],
  
  // Doctor Management
  DOCTOR_FULL: [
    PERMISSIONS.DOCTOR_READ,
    PERMISSIONS.DOCTOR_CREATE,
    PERMISSIONS.DOCTOR_UPDATE,
    PERMISSIONS.DOCTOR_DELETE,
    PERMISSIONS.DOCTOR_VERIFY,
    PERMISSIONS.DOCTOR_SUSPEND,
  ],
  DOCTOR_MANAGE: [
    PERMISSIONS.DOCTOR_READ,
    PERMISSIONS.DOCTOR_UPDATE,
    PERMISSIONS.DOCTOR_VERIFY,
  ],
  
  // Appointment Management
  APPOINTMENT_FULL: [
    PERMISSIONS.APPOINTMENT_READ,
    PERMISSIONS.APPOINTMENT_CREATE,
    PERMISSIONS.APPOINTMENT_UPDATE,
    PERMISSIONS.APPOINTMENT_DELETE,
    PERMISSIONS.APPOINTMENT_CANCEL,
    PERMISSIONS.APPOINTMENT_EXPORT,
  ],
  APPOINTMENT_MANAGE: [
    PERMISSIONS.APPOINTMENT_READ,
    PERMISSIONS.APPOINTMENT_UPDATE,
    PERMISSIONS.APPOINTMENT_CANCEL,
  ],
  
  // Clinical (Doctor)
  CLINICAL_FULL: [
    PERMISSIONS.PATIENT_READ_ASSIGNED,
    PERMISSIONS.PATIENT_HISTORY_READ,
    PERMISSIONS.PATIENT_LAB_READ,
    PERMISSIONS.CLINICAL_NOTE_READ,
    PERMISSIONS.CLINICAL_NOTE_CREATE,
    PERMISSIONS.CLINICAL_NOTE_UPDATE,
    PERMISSIONS.PRESCRIPTION_READ,
    PERMISSIONS.PRESCRIPTION_CREATE,
    PERMISSIONS.PRESCRIPTION_UPDATE,
    PERMISSIONS.TEMPLATE_READ,
    PERMISSIONS.TEMPLATE_CREATE,
    PERMISSIONS.TEMPLATE_UPDATE,
    PERMISSIONS.TEMPLATE_DELETE,
  ],
  
  // IoT & AI (Doctor)
  IOT_AI_FULL: [
    PERMISSIONS.IOT_READ,
    PERMISSIONS.IOT_DEVICE_READ,
    PERMISSIONS.IOT_HISTORY_READ,
    PERMISSIONS.IOT_ALERT_READ,
    PERMISSIONS.AI_ASSISTANT_USE,
    PERMISSIONS.AI_DIAGNOSIS_READ,
    PERMISSIONS.AI_DIAGNOSIS_APPROVE,
    PERMISSIONS.AI_TREATMENT_READ,
  ],
  
  // Emergency Operations (Operator level)
  EMERGENCY_OPERATOR: [
    PERMISSIONS.EMERGENCY_READ,           // View dashboard
    PERMISSIONS.EMERGENCY_DISPATCH,       // Dispatch ambulances
    PERMISSIONS.EMERGENCY_RESPOND,        // Respond to emergencies
    PERMISSIONS.EMERGENCY_COMMUNICATE,    // Communications center
    PERMISSIONS.EMERGENCY_FLEET_READ,     // View fleet
    PERMISSIONS.EMERGENCY_MAP_READ,       // View map
    PERMISSIONS.EMERGENCY_TRIAGE_READ,    // View triage
    PERMISSIONS.EMERGENCY_LOG_READ,       // View logs
  ],
  
  // Emergency Management (Admin level)
  EMERGENCY_ADMIN: [
    PERMISSIONS.EMERGENCY_READ,
    PERMISSIONS.EMERGENCY_DISPATCH,
    PERMISSIONS.EMERGENCY_RESPOND,
    PERMISSIONS.EMERGENCY_COMMUNICATE,
    PERMISSIONS.EMERGENCY_FLEET_READ,
    PERMISSIONS.EMERGENCY_MAP_READ,
    PERMISSIONS.EMERGENCY_TRIAGE_READ,
    PERMISSIONS.EMERGENCY_LOG_READ,
    PERMISSIONS.EMERGENCY_PERSONNEL_MANAGE,  // Manage personnel
    PERMISSIONS.EMERGENCY_ANALYTICS_READ,    // View analytics
    PERMISSIONS.EMERGENCY_SETTINGS_UPDATE,   // Update settings
  ],
  
  // Emergency Full (Super-Admin)
  EMERGENCY_FULL: [
    PERMISSIONS.EMERGENCY_READ,
    PERMISSIONS.EMERGENCY_DISPATCH,
    PERMISSIONS.EMERGENCY_RESPOND,
    PERMISSIONS.EMERGENCY_COMMUNICATE,
    PERMISSIONS.EMERGENCY_FLEET_READ,
    PERMISSIONS.EMERGENCY_MAP_READ,
    PERMISSIONS.EMERGENCY_TRIAGE_READ,
    PERMISSIONS.EMERGENCY_LOG_READ,
    PERMISSIONS.EMERGENCY_PERSONNEL_MANAGE,
    PERMISSIONS.EMERGENCY_ANALYTICS_READ,
    PERMISSIONS.EMERGENCY_SETTINGS_UPDATE,
  ],
};

/**
 * Resource types for permission checking
 */
export const RESOURCES = {
  DASHBOARD: 'dashboard',
  USER: 'user',
  DOCTOR: 'doctor',
  APPOINTMENT: 'appointment',
  FINANCE: 'finance',
  SUPPORT: 'support',
  CONTENT: 'content',
  SYSTEM: 'system',
  PHARMACY: 'pharmacy',
  EMERGENCY: 'emergency',
  PATIENT: 'patient',
  CLINICAL: 'clinical',
  PRESCRIPTION: 'prescription',
  TEMPLATE: 'template',
  IOT: 'iot',
  AI: 'ai',
  EARNING: 'earning',
  ANALYTICS: 'analytics',
  PROFILE: 'profile',
} as const;

/**
 * Actions for permission checking
 */
export const ACTIONS = {
  READ: 'read',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  EXPORT: 'export',
  APPROVE: 'approve',
  VERIFY: 'verify',
  SUSPEND: 'suspend',
  DISPATCH: 'dispatch',
  RESPOND: 'respond',
  CLOSE: 'close',
  ASSIGN: 'assign',
  PUBLISH: 'publish',
  USE: 'use',
  MANAGE: 'manage',
  PROCESS: 'process',
} as const;
