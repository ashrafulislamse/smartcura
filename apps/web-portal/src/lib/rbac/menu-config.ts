/**
 * Menu Configuration with RBAC
 * Defines sidebar menu structure with permission requirements
 */

import { Permission, PERMISSIONS } from './permissions';

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  route?: string;
  requiredPermission?: Permission;
  children?: MenuItem[];
}

export interface MenuGroup {
  id: string;
  label: string;
  items: MenuItem[];
}

/**
 * Complete menu structure with RBAC permissions (Modern)
 */
export const MENU_CONFIG: MenuGroup[] = [
  // Dashboard - Only for Admin roles (pharmacy users don't need this)
  {
    id: 'main',
    label: '',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: 'dashboard',
        route: '/dashboard',
        requiredPermission: PERMISSIONS.DASHBOARD_VIEW,
      },
    ],
  },
  
  // Users & Access
  {
    id: 'users-access',
    label: 'Users & Access',
    items: [
      {
        id: 'doctors',
        label: 'Medical Staff',
        icon: 'stethoscope',
        route: '/users/doctors',
        requiredPermission: PERMISSIONS.DOCTOR_READ,
      },
      {
        id: 'verification',
        label: 'Verification',
        icon: 'verified_user',
        route: '/users/verification',
        requiredPermission: PERMISSIONS.DOCTOR_VERIFY,
      },
      {
        id: 'patients',
        label: 'Patients',
        icon: 'group',
        route: '/users/patients',
        requiredPermission: PERMISSIONS.USER_READ,
      },
    ],
  },

  // Devices
  {
    id: 'devices',
    label: 'Devices',
    items: [
      {
        id: 'devices',
        label: 'Device Registry',
        icon: 'devices',
        route: '/devices',
        requiredPermission: PERMISSIONS.IOT_DEVICE_MANAGE,
      },
    ],
  },

  // Operations
  {
    id: 'operations',
    label: 'Operations',
    items: [
      {
        id: 'appointments',
        label: 'Appointments',
        icon: 'calendar_month',
        route: '/appointments',
        requiredPermission: PERMISSIONS.APPOINTMENT_READ,
      },
      {
        id: 'finance',
        label: 'Finance',
        icon: 'payments',
        requiredPermission: PERMISSIONS.FINANCE_READ,
        children: [
          {
            id: 'finance-dashboard',
            label: 'Overview',
            icon: 'dashboard',
            route: '/finance',
            requiredPermission: PERMISSIONS.FINANCE_READ,
          },
          {
            id: 'finance-transactions',
            label: 'Transactions',
            icon: 'receipt_long',
            route: '/finance/transactions',
            requiredPermission: PERMISSIONS.FINANCE_TRANSACTION_READ,
          },
          {
            id: 'finance-payouts',
            label: 'Payouts',
            icon: 'account_balance_wallet',
            route: '/finance/payouts',
            requiredPermission: PERMISSIONS.FINANCE_PAYOUT_READ,
          },
        ],
      },
      {
        id: 'support',
        label: 'Support',
        icon: 'support_agent',
        route: '/support/tickets',
        requiredPermission: PERMISSIONS.SUPPORT_READ,
        children: [
          {
            id: 'support-tickets',
            label: 'Tickets',
            icon: 'confirmation_number',
            route: '/support/tickets',
            requiredPermission: PERMISSIONS.SUPPORT_READ,
          },
          {
            id: 'support-faq',
            label: 'FAQ',
            icon: 'help',
            route: '/support/faq',
            requiredPermission: PERMISSIONS.CONTENT_READ,
          },
          {
            id: 'support-notifications',
            label: 'Notifications',
            icon: 'notifications',
            route: '/support/notifications',
            requiredPermission: PERMISSIONS.CONTENT_UPDATE,
          },
        ],
      },
    ],
  },
  
  // Pharmacy Operations (No label for pharmacy-only users, flat menu)
  {
    id: 'pharmacy-operations',
    label: '', // Empty label - pharmacy users don't need section header
    items: [
      {
        id: 'pharmacy-overview',
        label: 'Overview',
        icon: 'dashboard',
        route: '/pharmacy/dashboard',
        requiredPermission: PERMISSIONS.PHARMACY_READ,
      },
      {
        id: 'pharmacy-validation',
        label: 'Validation Hub',
        icon: 'fact_check',
        route: '/pharmacy/validation',
        requiredPermission: PERMISSIONS.PHARMACY_VALIDATION_READ,
      },
      {
        id: 'pharmacy-fulfillment',
        label: 'Fulfillment',
        icon: 'assignment',
        route: '/pharmacy/fulfillment',
        requiredPermission: PERMISSIONS.PHARMACY_FULFILLMENT_READ,
      },
      {
        id: 'pharmacy-logistics',
        label: 'Logistics',
        icon: 'local_shipping',
        route: '/pharmacy/logistics',
        requiredPermission: PERMISSIONS.PHARMACY_LOGISTICS_READ,
      },
      {
        id: 'pharmacy-inventory',
        label: 'Inventory',
        icon: 'inventory_2',
        route: '/pharmacy/inventory',
        requiredPermission: PERMISSIONS.PHARMACY_INVENTORY_READ,
      },
      {
        id: 'pharmacy-intake',
        label: 'Medicine Intake',
        icon: 'add_circle',
        route: '/pharmacy/intake',
        requiredPermission: PERMISSIONS.PHARMACY_INTAKE_CREATE,
      },
      {
        id: 'pharmacy-reconciliation',
        label: 'Reconciliation',
        icon: 'fact_check',
        route: '/pharmacy/reconciliation',
        requiredPermission: PERMISSIONS.PHARMACY_RECONCILIATION_READ,
      },
      {
        id: 'pharmacy-controlled',
        label: 'Controlled Substances',
        icon: 'gavel',
        route: '/pharmacy/controlled-substances',
        requiredPermission: PERMISSIONS.PHARMACY_CONTROLLED_READ,
      },
      {
        id: 'pharmacy-returns',
        label: 'Returns & Disposal',
        icon: 'delete_sweep',
        route: '/pharmacy/returns',
        requiredPermission: PERMISSIONS.PHARMACY_RETURNS_READ,
      },
      {
        id: 'pharmacy-procurement',
        label: 'Procurement',
        icon: 'shopping_cart',
        route: '/pharmacy/procurement',
        requiredPermission: PERMISSIONS.PHARMACY_PROCUREMENT_READ,
      },
      {
        id: 'pharmacy-analytics',
        label: 'Analytics',
        icon: 'analytics',
        route: '/pharmacy/analytics',
        requiredPermission: PERMISSIONS.PHARMACY_ANALYTICS_READ,
      },
      {
        id: 'pharmacy-orders',
        label: 'Orders',
        icon: 'receipt_long',
        route: '/pharmacy/orders',
        requiredPermission: PERMISSIONS.PHARMACY_ORDER_READ,
      },
      {
        id: 'pharmacy-medications',
        label: 'Medication Catalogue',
        icon: 'medication_liquid',
        route: '/pharmacy/medications',
        requiredPermission: PERMISSIONS.PHARMACY_READ,
      },
    ],
  },
  
  // Emergency Operations (Flat structure like Doctor)
  {
    id: 'emergency-operations',
    label: 'Emergency Operations',
    items: [
      {
        id: 'emergency-dashboard',
        label: 'Command Center',
        icon: 'emergency',
        route: '/emergency',
        requiredPermission: PERMISSIONS.EMERGENCY_READ,
      },
      {
        id: 'emergency-triage',
        label: 'Triage Queue',
        icon: 'priority_high',
        route: '/emergency/triage',
        requiredPermission: PERMISSIONS.EMERGENCY_TRIAGE_READ,
      },
      {
        id: 'emergency-map',
        label: 'Response Map',
        icon: 'map',
        route: '/emergency/map',
        requiredPermission: PERMISSIONS.EMERGENCY_MAP_READ,
      },
      {
        id: 'emergency-fleet',
        label: 'Fleet Management',
        icon: 'local_shipping',
        route: '/emergency/fleet',
        requiredPermission: PERMISSIONS.EMERGENCY_FLEET_READ,
      },
      {
        id: 'emergency-communications',
        label: 'Communications',
        icon: 'phone_in_talk',
        route: '/emergency/communications',
        requiredPermission: PERMISSIONS.EMERGENCY_COMMUNICATE,
      },
    ],
  },
  
  // Emergency Analytics & Logs
  {
    id: 'emergency-analytics',
    label: 'Analytics & Logs',
    items: [
      {
        id: 'emergency-logs',
        label: 'SOS Logs',
        icon: 'history',
        route: '/emergency/logs',
        requiredPermission: PERMISSIONS.EMERGENCY_LOG_READ,
      },
      {
        id: 'emergency-analytics',
        label: 'Performance Analytics',
        icon: 'bar_chart',
        route: '/emergency/analytics',
        requiredPermission: PERMISSIONS.EMERGENCY_ANALYTICS_READ, // Admin only
      },
    ],
  },
  
  // Emergency Management (Admin only)
  {
    id: 'emergency-management',
    label: 'Management',
    items: [
      {
        id: 'emergency-personnel',
        label: 'Personnel',
        icon: 'badge',
        route: '/emergency/personnel',
        requiredPermission: PERMISSIONS.EMERGENCY_PERSONNEL_MANAGE, // Admin only
      },
      {
        id: 'emergency-settings',
        label: 'System Settings',
        icon: 'settings',
        route: '/emergency/settings',
        requiredPermission: PERMISSIONS.EMERGENCY_SETTINGS_UPDATE, // Admin only
      },
    ],
  },
  
  // System
  {
    id: 'system',
    label: 'System',
    items: [
      {
        id: 'reports',
        label: 'Reports',
        icon: 'analytics',
        route: '/reports',
        requiredPermission: PERMISSIONS.ANALYTICS_READ,
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: 'settings',
        route: '/settings',
        requiredPermission: PERMISSIONS.SYSTEM_READ,
        children: [
          {
            id: 'settings-general',
            label: 'General',
            icon: 'tune',
            route: '/settings',
            requiredPermission: PERMISSIONS.SYSTEM_READ,
          },
          {
            id: 'settings-notifications',
            label: 'Notifications',
            icon: 'notifications',
            route: '/settings/notifications',
            requiredPermission: PERMISSIONS.SYSTEM_UPDATE,
          },
          {
            id: 'settings-templates',
            label: 'Notification Templates',
            icon: 'drafts',
            route: '/settings/notification-templates',
            requiredPermission: PERMISSIONS.SYSTEM_UPDATE,
          },
          {
            id: 'settings-roles',
            label: 'Roles',
            icon: 'shield_person',
            route: '/settings/roles',
            requiredPermission: PERMISSIONS.SYSTEM_ROLE_MANAGE,
          },
          {
            id: 'settings-audit',
            label: 'Audit Logs',
            icon: 'receipt_long',
            route: '/settings/audit-logs',
            requiredPermission: PERMISSIONS.SYSTEM_AUDIT_READ,
          },
          {
            id: 'settings-analytics',
            label: 'Analytics',
            icon: 'analytics',
            route: '/settings/analytics',
            requiredPermission: PERMISSIONS.ANALYTICS_READ,
          },
          {
            id: 'settings-profile',
            label: 'Profile',
            icon: 'badge',
            route: '/settings/profile',
            requiredPermission: PERMISSIONS.PROFILE_READ,
          },
          {
            id: 'settings-admins',
            label: 'Admin Users',
            icon: 'manage_accounts',
            route: '/settings/admin-users',
            requiredPermission: PERMISSIONS.SYSTEM_ADMIN_MANAGE,
          },
          {
            id: 'settings-exports',
            label: 'Data Exports',
            icon: 'cloud_download',
            route: '/settings/exports',
            requiredPermission: PERMISSIONS.EXPORT_REQUEST,
          },
          {
            id: 'settings-firmware',
            label: 'Firmware',
            icon: 'system_update',
            route: '/settings/firmware',
            requiredPermission: PERMISSIONS.IOT_FIRMWARE_MANAGE,
          },
        ],
      },
    ],
  },
];

/**
 * Doctor Role Menu Configuration (Modern)
 */
export const DOCTOR_MENU_CONFIG: MenuGroup[] = [
  // Dashboard
  {
    id: 'main',
    label: '',
    items: [
      {
        id: 'doctor-dashboard',
        label: 'Dashboard',
        icon: 'dashboard',
        route: '/doctor/dashboard',
        requiredPermission: PERMISSIONS.DASHBOARD_VIEW,
      },
    ],
  },
  
  // Patients
  {
    id: 'patients',
    label: 'Patients',
    items: [
      {
        id: 'my-patients',
        label: 'My Patients',
        icon: 'group',
        route: '/doctor/patients',
        requiredPermission: PERMISSIONS.PATIENT_READ_ASSIGNED,
      },
    ],
  },
  
  // Appointments
  {
    id: 'appointments',
    label: 'Appointments',
    items: [
      {
        id: 'my-schedule',
        label: 'My Schedule',
        icon: 'calendar_month',
        route: '/doctor/schedule',
        requiredPermission: PERMISSIONS.APPOINTMENT_READ_OWN,
      },
      {
        id: 'appointments-list',
        label: 'Appointments List',
        icon: 'list',
        route: '/doctor/appointments',
        requiredPermission: PERMISSIONS.APPOINTMENT_READ_OWN,
      },
    ],
  },
  
  // Clinical
  {
    id: 'clinical',
    label: 'Clinical',
    items: [
      {
        id: 'consultation-notes',
        label: 'Consultation Notes',
        icon: 'note_add',
        route: '/doctor/notes',
        requiredPermission: PERMISSIONS.CLINICAL_NOTE_READ,
      },
      {
        id: 'prescriptions',
        label: 'Prescriptions',
        icon: 'medication',
        route: '/doctor/prescriptions',
        requiredPermission: PERMISSIONS.PRESCRIPTION_READ,
      },
      {
        id: 'doctor-inbox',
        label: 'Inbox',
        icon: 'inbox',
        route: '/doctor/inbox',
        requiredPermission: PERMISSIONS.CLINICAL_NOTE_READ,
      },
      {
        id: 'templates',
        label: 'Templates',
        icon: 'description',
        route: '/doctor/templates',
        requiredPermission: PERMISSIONS.TEMPLATE_READ,
      },
    ],
  },
  
  // IoT Monitoring
  {
    id: 'iot',
    label: 'IoT Monitoring',
    items: [
      {
        id: 'patient-monitoring',
        label: 'Patient Monitoring',
        icon: 'vital_signs',
        route: '/doctor/iot/patients',
        requiredPermission: PERMISSIONS.IOT_DEVICE_READ,
      },
    ],
  },
  
  // AI Assistant
  {
    id: 'ai',
    label: 'AI Assistant',
    items: [
      {
        id: 'clinical-assistant',
        label: 'Clinical Assistant',
        icon: 'psychology',
        route: '/doctor/ai/assistant',
        requiredPermission: PERMISSIONS.AI_ASSISTANT_USE,
      },
      {
        id: 'ai-artifacts',
        label: 'AI Artifacts',
        icon: 'auto_awesome',
        route: '/doctor/ai/artifacts',
        requiredPermission: PERMISSIONS.AI_ASSISTANT_USE,
      },
    ],
  },
  
  // Earnings
  {
    id: 'earnings',
    label: 'Earnings',
    items: [
      {
        id: 'earnings-payouts',
        label: 'Earnings & Payouts',
        icon: 'account_balance_wallet',
        route: '/doctor/earnings',
        requiredPermission: PERMISSIONS.EARNING_READ_OWN,
      },
    ],
  },
  
  // Analytics
  {
    id: 'analytics',
    label: 'Analytics',
    items: [
      {
        id: 'my-analytics',
        label: 'My Analytics',
        icon: 'analytics',
        route: '/doctor/analytics',
        requiredPermission: PERMISSIONS.ANALYTICS_READ_OWN,
      },
    ],
  },

  // Professional Profile
  {
    id: 'doctor-profile-section',
    label: 'Profile',
    items: [
      {
        id: 'doctor-profile',
        label: 'Professional Profile',
        icon: 'badge',
        route: '/doctor/profile',
        requiredPermission: PERMISSIONS.PROFILE_READ,
      },
    ],
  },
];

/**
 * Pharmacy Role Menu Configuration (Modern)
 */
export const PHARMACY_MENU_CONFIG: MenuGroup[] = [
  // Pharmacy Operations (Flat structure - no section header)
  {
    id: 'pharmacy-operations',
    label: '', // No section header for pharmacy-only users
    items: [
      {
        id: 'pharmacy-overview',
        label: 'Overview',
        icon: 'dashboard',
        route: '/pharmacy/dashboard',
        requiredPermission: PERMISSIONS.PHARMACY_READ,
      },
      {
        id: 'pharmacy-validation',
        label: 'Validation Hub',
        icon: 'fact_check',
        route: '/pharmacy/validation',
        requiredPermission: PERMISSIONS.PHARMACY_VALIDATION_READ,
      },
      {
        id: 'pharmacy-fulfillment',
        label: 'Fulfillment',
        icon: 'assignment',
        route: '/pharmacy/fulfillment',
        requiredPermission: PERMISSIONS.PHARMACY_FULFILLMENT_READ,
      },
      {
        id: 'pharmacy-logistics',
        label: 'Logistics',
        icon: 'local_shipping',
        route: '/pharmacy/logistics',
        requiredPermission: PERMISSIONS.PHARMACY_LOGISTICS_READ,
      },
      {
        id: 'pharmacy-inventory',
        label: 'Inventory',
        icon: 'inventory_2',
        route: '/pharmacy/inventory',
        requiredPermission: PERMISSIONS.PHARMACY_INVENTORY_READ,
      },
      {
        id: 'pharmacy-intake',
        label: 'Medicine Intake',
        icon: 'add_circle',
        route: '/pharmacy/intake',
        requiredPermission: PERMISSIONS.PHARMACY_INTAKE_CREATE,
      },
      {
        id: 'pharmacy-reconciliation',
        label: 'Reconciliation',
        icon: 'fact_check',
        route: '/pharmacy/reconciliation',
        requiredPermission: PERMISSIONS.PHARMACY_RECONCILIATION_READ,
      },
      {
        id: 'pharmacy-controlled',
        label: 'Controlled Substances',
        icon: 'gavel',
        route: '/pharmacy/controlled-substances',
        requiredPermission: PERMISSIONS.PHARMACY_CONTROLLED_READ,
      },
      {
        id: 'pharmacy-returns',
        label: 'Returns & Disposal',
        icon: 'delete_sweep',
        route: '/pharmacy/returns',
        requiredPermission: PERMISSIONS.PHARMACY_RETURNS_READ,
      },
      {
        id: 'pharmacy-procurement',
        label: 'Procurement',
        icon: 'shopping_cart',
        route: '/pharmacy/procurement',
        requiredPermission: PERMISSIONS.PHARMACY_PROCUREMENT_READ,
      },
      {
        id: 'pharmacy-analytics',
        label: 'Analytics',
        icon: 'analytics',
        route: '/pharmacy/analytics',
        requiredPermission: PERMISSIONS.PHARMACY_ANALYTICS_READ,
      },
      {
        id: 'pharmacy-orders',
        label: 'Orders',
        icon: 'receipt_long',
        route: '/pharmacy/orders',
        requiredPermission: PERMISSIONS.PHARMACY_ORDER_READ,
      },
      {
        id: 'pharmacy-medications',
        label: 'Medication Catalogue',
        icon: 'medication_liquid',
        route: '/pharmacy/medications',
        requiredPermission: PERMISSIONS.PHARMACY_READ,
      },
    ],
  },
];

/**
 * Get menu configuration based on role
 */
export function getMenuForRole(roleId: string): MenuGroup[] {
  if (roleId === 'doctor') {
    return DOCTOR_MENU_CONFIG;
  }
  if (roleId === 'pharmacy') {
    return PHARMACY_MENU_CONFIG;
  }
  return MENU_CONFIG;
}
