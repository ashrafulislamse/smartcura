/**
 * Portal-to-backend permission mapping.
 *
 * The portal's menu config and route guards use a portal-local permission vocabulary
 * (`doctor:read`, `appointment:read`, etc.). The backend's session bootstrap returns
 * a different vocabulary with explicit scopes (`doctor_detail:read:global`,
 * `appointment:read:organization`, `pharmacy.order:read:site`, etc.). Without a
 * bridge, every menu item is filtered out because the two vocabularies never line up.
 *
 * This file names the bridge. For each portal permission the menu or a route guard
 * requires, the list names every backend permission that satisfies it. The portal's
 * `hasPermission` consults this map after the exact-match and wildcard checks.
 *
 * Keep the map small. A portal permission that maps to a long list of backend
 * permissions is usually a sign that the portal vocabulary is too coarse; prefer
 * tightening the portal vocabulary instead of widening the map.
 *
 * Backend permission strings are authoritative: they come from the `permissions` table
 * and are returned in the `POST /sessions` bootstrap payload. If a backend permission
 * is renamed, update this map, not the portal's menu config.
 *
 * Scopes used by the backend: `own` (the caller's own row), `assigned` (rows assigned
 * to the caller), `site` (rows in the caller's sites), `organization` (rows in the
 * caller's org), `global` (no scope restriction), `device` (the device itself, for IoT
 * ingestion). The legacy `org` alias was converged to `organization` in migration 0047.
 */

export const PORTAL_TO_BACKEND_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  // Dashboard: any operational role reads at least one summary the dashboard surfaces.
  'dashboard:read': [
    'appointment:read:organization',
    'appointment:read:global',
    'doctor_detail:read:global',
    'support.ticket:manage:organization',
    'ledger:read:organization',
    'break_glass:review',
    'audit:read:organization',
    'audit:read:global',
    'patient.record:read',
    'emergency.event:read:site',
  ],

  // Users & access
  'doctor:read': ['doctor_detail:read:global', 'doctor.profile:read', 'doctor_review:read:global'],
  'doctor:create': ['doctor_verification:manage:organization', 'doctor.profile:update:global'],
  'doctor:update': ['doctor.profile:update:organization', 'doctor.profile:update:global', 'doctor_verification:manage:organization'],
  'doctor:delete': ['doctor_verification:manage:organization', 'doctor.profile:update:global'],
  'doctor:verify': ['doctor_verification:manage:organization', 'doctor.profile:update:global'],
  'doctor:suspend': ['doctor_verification:manage:organization', 'doctor.profile:update:global'],
  'user:read': ['membership:read:organization', 'membership:read:global'],
  'user:create': ['membership:invite:organization', 'membership:invite:global'],
  'user:update': ['membership:manage:organization', 'membership:transition:organization'],
  'user:delete': ['membership:manage:organization'],
  'user:suspend': ['membership:transition:organization', 'membership:transition:global'],
  'user:export': ['export:create:organization', 'export:create:global'],

  // Appointments
  'appointment:read': ['appointment:read:organization', 'appointment:read:global'],
  'appointment:create': ['appointment:create:organization', 'appointment:create:global'],
  'appointment:update': ['appointment:update:organization', 'appointment:update:global'],
  'appointment:delete': ['appointment:delete:organization', 'appointment:delete:global'],
  'appointment:cancel': ['appointment:cancel:organization', 'appointment:cancel:assigned', 'appointment:cancel:global'],
  'appointment:export': ['export:create:organization', 'export:create:global'],
  // Doctor menu/routes are restricted to appointments assigned to that membership.
  // Organization scope belongs to administrative scheduling views, never this own-scope item.
  'appointment:read:own': ['appointment:read:assigned'],

  // Finance
  'finance:read': ['finance:read:organization', 'ledger:read:organization'],
  'finance:transaction:read': ['ledger:read:organization'],
  'finance:payout:read': ['payout_run:manage:organization', 'payout_run:approve:organization'],
  'finance:payout:process': ['payout_run:manage:organization', 'payout_run:approve:organization'],
  'finance:export': ['export:create:organization', 'export:create:global'],

  // Support
  'support:read': ['support.ticket:manage:organization'],
  'support:create': ['support.ticket:manage:organization'],
  'support:update': ['support.ticket:manage:organization'],
  'support:respond': ['support.ticket:manage:organization'],
  'support:close': ['support.ticket:manage:organization'],
  'support:assign': ['support.ticket:manage:organization'],

  // Content
  'content:read': ['content:manage:organization'],
  'content:create': ['content:manage:organization'],
  'content:update': ['content:manage:organization'],
  'content:delete': ['content:manage:organization'],
  'content:publish': ['content:manage:organization'],

  // Emergency: admin sees emergencies through break-glass and audit; operators have their own set
  'emergency:read': [
    'break_glass:review',
    'break_glass:activate',
    'audit:read:organization',
    'audit:read:global',
    'emergency.event:read:site',
    'emergency.event:read:organization',
    'emergency.event:read:global',
  ],
  'emergency:dispatch': [
    'break_glass:review',
    'emergency.dispatch:create:site',
    'emergency.dispatch:create:organization',
    'emergency.dispatch:manage:site',
  ],
  'emergency:log:read': ['audit:read:organization', 'audit:read:global', 'emergency.event:read:site', 'emergency.event:read:organization'],
  'emergency:respond': ['break_glass:review', 'break_glass:activate', 'emergency.resolution:create:site', 'emergency.event:update:site'],
  'emergency:communicate': ['break_glass:review', 'emergency.communication:manage:site', 'emergency.comms:read:site'],
  'emergency:fleet:read': ['break_glass:review', 'emergency.fleet:read:site', 'fleet:read:organization'],
  'emergency:map:read': ['break_glass:review', 'emergency.fleet:read:site', 'fleet:read:organization'],
  'emergency:triage:read': ['break_glass:review', 'emergency.triage:manage:site', 'emergency.triage:read:site'],
  'emergency:personnel:manage': ['membership:manage:organization', 'membership:manage:global'],
  'emergency:analytics:read': ['audit:read:organization', 'audit:read:global'],
  'emergency:settings:update': ['system.setting:manage:organization', 'system.setting:*:global'],

  // System
  'system:read': ['system.setting:manage:organization', 'system.setting:*:global', 'system.security:*:global'],
  'system:update': ['system.setting:manage:organization', 'system.setting:*:global'],
  'system:admin:manage': ['membership:manage:organization', 'membership:manage:global', 'role:*:global'],
  'system:role:manage': ['custom_role:manage:organization', 'role:*:global'],
  'system:audit:read': ['audit:read:organization', 'audit:read:global'],

  // Analytics
  'analytics:read': ['ledger:read:organization', 'audit:read:organization'],

  // Profile (every authenticated user has at least own-scope)
  'profile:read': [
    'profile:read:own',
    'profile:manage:own',
    'profile_detail:read:own',
  ],
  'profile:update': [
    'profile:update:own',
    'profile:manage:own',
    'profile_detail:write:own',
  ],

  // Doctor clinical
  'patient:read:assigned': [
    'patient.record:read',
    'care.assignment:read:assigned',
    'profile.clinical:read:assigned',
  ],
  'patient:history:read': ['profile.clinical:read:assigned', 'patient.record:read'],
  'patient:lab:read': ['patient.lab:read:assigned', 'patient.record:read'],
  'clinical:note:read': ['clinical_note:read:assigned', 'clinical_note:manage:assigned'],
  'clinical:note:create': ['clinical_note:manage:assigned', 'clinical_note:create:assigned'],
  'clinical:note:update': ['clinical_note:manage:assigned', 'clinical_note:update:assigned'],
  'prescription:read': ['prescription:read:assigned', 'prescription.sign:assigned'],
  'prescription:create': ['prescription:create:assigned', 'prescription.sign:assigned'],
  'prescription:update': ['prescription:create:assigned', 'prescription:read:assigned'],
  'template:read': ['template:read:own', 'template:read:organization', 'template:*:own'],
  'template:create': ['template:create:own', 'template:create:organization'],
  'template:update': ['template:update:own', 'template:update:organization'],
  'template:delete': ['template:delete:own', 'template:delete:organization'],

  // Doctor consultations
  'consultation:read': ['consultation:manage:assigned', 'consultation:read:assigned'],
  'consultation:create': ['consultation:manage:assigned', 'consultation:create:assigned'],
  'consultation:update': ['consultation:manage:assigned', 'consultation:update:assigned'],

  // IoT
  'iot:read': ['iot.reading:read:assigned', 'iot:read', 'iot.alert:manage:assigned'],
  'iot:device:read': ['iot.device:read', 'iot.reading:read:assigned', 'iot.alert:manage:assigned'],
  'iot:history:read': ['reading:read:assigned', 'iot.reading:read:assigned'],
  'iot:alert:read': ['alert:read:assigned', 'iot.alert:manage:assigned', 'iot.alert:escalate:assigned'],
  'iot:device:manage': ['device:assign:organization', 'device:register:organization', 'device:read:organization'],
  'iot:device:assign': ['device:assign:assigned', 'device:read:assigned'],

  // Break-glass — activate a break-glass grant and read the disclosed patient record
  'break_glass:activate': ['break_glass:activate', 'patient.record:read'],

  // AI
  'ai:assistant:use': ['ai.assistant:use', 'ai.artifact:read:assigned'],
  'ai:diagnosis:read': ['ai.artifact:read:assigned', 'ai.diagnosis:read'],
  'ai:diagnosis:approve': ['ai.artifact:review:assigned', 'ai.diagnosis:approve'],
  'ai:treatment:read': ['ai.treatment:read', 'ai.artifact:read:assigned'],

  // Earnings & analytics (own scope)
  'earning:read:own': ['earning:read:own'],
  'earning:export:own': ['earning:export:own'],
  'analytics:read:own': ['analytics:read:own'],

  // Pharmacy
  'pharmacy:read': [
    'pharmacy.catalogue:read:site',
    'pharmacy.catalogue:manage:site',
    'pharmacy:read:site',
    'pharmacy:read:organization',
  ],
  'pharmacy:order:read': ['pharmacy.order:read:site', 'pharmacy.order:read:organization'],
  'pharmacy:order:update': ['pharmacy.order:update:site', 'pharmacy.order:update:organization'],
  'pharmacy:order:dispatch': ['dispatch_job:create:site', 'dispatch.job:manage:site', 'pharmacy.order:dispatch:site'],
  'pharmacy:validation:read': ['prescription_validation:manage:site', 'pharmacy.validation:read:site'],
  'pharmacy:validation:approve': ['prescription_validation:manage:site', 'pharmacy.validation:approve:site'],
  'pharmacy:fulfillment:read': ['reconciliation:manage:site', 'dispatch.job:manage:site', 'pharmacy.fulfillment:read:site'],
  'pharmacy:fulfillment:update': ['reconciliation:manage:site', 'dispatch.job:manage:site', 'pharmacy.fulfillment:update:site'],
  'pharmacy:logistics:read': ['dispatch.job:manage:site', 'dispatch_job:create:site', 'pharmacy.logistics:read:site'],
  'pharmacy:logistics:assign': ['dispatch.job:manage:site', 'dispatch_job:create:site', 'pharmacy.logistics:assign:site'],
  'pharmacy:inventory:read': ['inventory:read:site', 'inventory.reservation:manage:site'],
  'pharmacy:controlled:read': ['controlled_substance:manage:site', 'pharmacy.controlled:read:site'],
  'pharmacy:returns:read': ['return:manage:site', 'pharmacy.returns:read:site'],
  'pharmacy:procurement:read': ['procurement:manage:site', 'pharmacy.procurement:read:site'],
  'pharmacy:analytics:read': ['pharmacy.analytics:read:site', 'pharmacy.analytics:read:organization', 'audit:read:site'],
  'pharmacy:intake:create': ['stock_ledger:post:site', 'inventory.reservation:manage:site', 'pharmacy.intake:create:site'],
  'pharmacy:reconciliation:read': ['reconciliation:manage:site', 'pharmacy.reconciliation:read:site'],
};
