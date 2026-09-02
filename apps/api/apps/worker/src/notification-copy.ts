/**
 * The single server-side catalogue that turns a notification row into the copy a
 * user actually reads, the deep link a tap follows, and the delivery priority.
 *
 * WHY SERVER-SIDE. Push previews are rendered by the OS from the FCM
 * `notification` field, so the server must supply real title/body text — before
 * this catalogue every push read "You have a new notification". The in-app list
 * keeps rendering from the same codes through the per-app catalogues, which mirror
 * these strings; codes stay the stable contract, copy is centralized here.
 *
 * WHY CODES STAY. The `notifications` table stores `title_code`/`body_code`, not
 * prose — that is what keeps PHI out of the database row and lets the apps
 * localise or restyle without a migration. This catalogue is the only place that
 * maps codes to English copy on the delivery path.
 *
 * PHI RULE. Copy may name the KIND of thing (appointment, prescription, order)
 * and carry a coarse time or status, but never a patient name, doctor name,
 * medication, condition, or address. A lock screen shows this text.
 */

import type { NotificationCategory, NotificationPriorityLevel } from '@smartcura/database/consultations';

export interface NotificationCopyWork {
  readonly category: NotificationCategory;
  readonly titleCode: string;
  readonly bodyCode: string;
  readonly resourceType: string;
  readonly resourceId: string;
}

export interface RenderedNotificationCopy {
  readonly title: string;
  readonly body: string;
  readonly priority: NotificationPriorityLevel;
  /** `smartcura://` link the tap follows; always inside the notified user's own app. */
  readonly deepLink: string;
  /** Android notification channel id — sound/vibration urgency follows this. */
  readonly androidChannel: string;
}

/**
 * Deep-link targets are ONLY entities with a real screen behind them:
 *   prescriptions/{id}, pharmacy-orders/{id}, appointments/{id},
 *   conversations/{id} (patient & doctor apps), orders/{id} (driver app).
 * Entities without a detail screen (emergency events, verification documents,
 * broadcasts) deep-link to the notification centre, where the notification's own
 * body carries the context — never to a home screen.
 */
export function deepLinkForResource(resourceType: string, resourceId: string): string {
  switch (resourceType) {
    case 'prescription':
      return `smartcura://prescriptions/${resourceId}`;
    case 'pharmacy_order':
      return `smartcura://pharmacy-orders/${resourceId}`;
    case 'appointment':
      return `smartcura://appointments/${resourceId}`;
    case 'conversation':
      return `smartcura://conversations/${resourceId}`;
    case 'dispatch_assignment':
      return `smartcura://orders/${resourceId}`;
    case 'dispatch_offer':
      // The driver app's offers list and order details both live under the
      // orders tab; the offer id routes there so the driver can review it.
      return `smartcura://orders/${resourceId}`;
    case 'health_alert':
      // The resourceId is the patient profile id (set by the vital-reading
      // repository). The doctor app's patient-details screen shows the active
      // alerts list with an acknowledge action.
      return `smartcura://patients/${resourceId}`;
    case 'consultation':
      // The patient and doctor apps do not yet have a consultation-summary
      // route, so the handler falls back to /notifications. Adding the case
      // here makes the URI well-formed so only the handler needs updating when
      // a detail screen lands.
      return `smartcura://consultations/${resourceId}`;
    case 'vital_reading':
      return 'smartcura://health';
    default:
      return 'smartcura://notifications';
  }
}

interface CopyEntry {
  readonly title: string;
  readonly body: string;
  readonly priority?: NotificationPriorityLevel;
}

/**
 * Per-title-code copy. The body says what happened, what to do, and where the tap
 * goes — the three things every notification must communicate.
 */
const COPY_BY_TITLE_CODE: Readonly<Record<string, CopyEntry>> = {
  // messages
  'message.new.title': {
    title: 'New message',
    body: 'You have a new message in a conversation. Tap to read and reply.',
  },
  // prescriptions
  'prescription.ready.title': {
    title: 'Prescription ready',
    body: 'A prescription issued to you is ready. Tap to view it and order from the pharmacy.',
  },
  'prescription.cancelled.title': {
    title: 'Prescription cancelled',
    body: 'A prescription issued to you was cancelled by the issuing doctor. Tap to view the details.',
  },
  // appointments (patient-facing)
  'appointment.confirmed.title': {
    title: 'Appointment confirmed',
    body: 'Your appointment is confirmed. Tap to view the date, time and joining instructions.',
  },
  'appointment.cancelled_by_patient.title': {
    title: 'Appointment cancelled',
    body: 'An appointment booked with you was cancelled by the patient. Tap to view the freed slot.',
  },
  'appointment.cancelled_by_doctor.title': {
    title: 'Appointment cancelled',
    body: 'Your appointment was cancelled by the doctor. Tap to view the reason and rebook.',
  },
  'appointment.rescheduled.title': {
    title: 'Appointment rescheduled',
    body: 'An appointment time changed. Tap to view the new date and time.',
  },
  'appointment.reminder.title': {
    title: 'Appointment reminder',
    body: 'You have an appointment in the next 24 hours. Tap to view the details.',
    priority: 'high',
  },
  'appointment.completed.title': {
    title: 'Appointment completed',
    body: 'Your appointment has been marked as completed. Tap to view the summary.',
  },
  'appointment.no_show.title': {
    title: 'Appointment missed',
    body: 'You were marked as absent for your appointment. Tap to view the details and rebook.',
  },
  // appointments (doctor-facing)
  'appointment.requested.title': {
    title: 'New appointment request',
    body: 'A patient requested an appointment with you. Tap to review and confirm or decline it.',
    priority: 'high',
  },
  // pharmacy delivery (patient-facing)
  'pharmacy_order.ready_for_dispatch.title': {
    title: 'Order ready for dispatch',
    body: 'Your pharmacy order is packed and awaiting a driver. Tap to track the order.',
  },
  'pharmacy_order.dispatched.title': {
    title: 'Order on its way',
    body: 'Your pharmacy order has been picked up for delivery. Tap to track the delivery.',
    priority: 'high',
  },
  'pharmacy_order.delivered.title': {
    title: 'Order delivered',
    body: 'Your pharmacy order was delivered. Tap to view the order and proof of delivery.',
  },
  'pharmacy_order.cancelled.title': {
    title: 'Order cancelled',
    body: 'A pharmacy order was cancelled. Tap to view the order details.',
  },
  // dispatch (driver-facing)
  'dispatch.offer.title': {
    title: 'New delivery offer',
    body: 'A delivery is available near you. Tap to review the fee and accept or decline it.',
    priority: 'high',
  },
  'dispatch.assignment.title': {
    title: 'Delivery assignment update',
    body: 'The status of a delivery assigned to you changed. Tap to view the assignment.',
    priority: 'high',
  },
  // verification
  'verification.approved.title': {
    title: 'Verification approved',
    body: 'Your verification document was approved. Tap to view the outcome.',
  },
  'verification.rejected.title': {
    title: 'Verification not approved',
    body: 'Your verification document was not approved. Tap to view the reviewer\'s note.',
  },
  'verification.changes_requested.title': {
    title: 'Verification changes requested',
    body: 'A reviewer asked for changes to your verification document. Tap to view what is needed.',
  },
  // health alerts (doctor-facing)
  'health.alert.raised.title': {
    title: 'Critical vitals alert',
    body: 'A monitoring alert was raised for a patient assigned to you. Tap to review the readings.',
    priority: 'high',
  },
  // vitals update (patient-facing)
  'vitals.received.title': {
    title: 'New health data',
    body: 'New vital readings were received from your device. Tap to view your latest health data.',
  },
  // consultations
  'consultation.ready.title': {
    title: 'Consultation ready',
    body: 'A consultation is ready to join. Tap to enter the consultation room.',
    priority: 'high',
  },
  'consultation.completed.title': {
    title: 'Consultation completed',
    body: 'A consultation has been completed. Tap to view the summary and any prescriptions.',
  },
  'consultation.cancelled.title': {
    title: 'Consultation cancelled',
    body: 'A consultation was cancelled. Tap to view the details.',
  },
  // emergency
  'emergency.created.title': {
    title: 'Emergency request',
    body: 'A new emergency request needs operator attention. Tap to open the emergency console.',
    priority: 'critical',
  },
  'emergency.resolved.title': {
    title: 'Emergency resolved',
    body: 'Your emergency request has been resolved. Tap to view the outcome.',
  },
  'emergency.cancelled.title': {
    title: 'Emergency cancelled',
    body: 'Your emergency request was cancelled. Tap to view the details.',
  },
};

const CATEGORY_FALLBACK: Readonly<Record<NotificationCategory, CopyEntry>> = {
  account_security: {
    title: 'Security notice',
    body: 'A security change affected your account. Tap to review it.',
    priority: 'high',
  },
  appointments: {
    title: 'Appointment update',
    body: 'An appointment you are part of changed. Tap to view the details.',
  },
  consultations: {
    title: 'Consultation update',
    body: 'A consultation you are part of changed. Tap to view the details.',
  },
  messages: {
    title: 'New message',
    body: 'You have a new message. Tap to read it.',
  },
  prescriptions: {
    title: 'Prescription update',
    body: 'A prescription issued to you changed. Tap to view the details.',
  },
  vitals_alerts: {
    title: 'Health monitoring alert',
    body: 'A monitoring alert needs your attention. Tap to review it.',
    priority: 'high',
  },
  ai_review: {
    title: 'Review update',
    body: 'A review you are waiting on changed status. Tap to view the outcome.',
  },
  delivery: {
    title: 'Delivery update',
    body: 'A delivery you are part of changed. Tap to view the details.',
  },
  dispatch: {
    title: 'Dispatch update',
    body: 'A dispatch offer or assignment needs your attention. Tap to view the details.',
    priority: 'high',
  },
  emergency: {
    title: 'Emergency update',
    body: 'An emergency event changed. Tap to view the details.',
    priority: 'critical',
  },
  system: {
    title: 'SmartCura notice',
    body: 'You have a new notice from SmartCura. Tap to read it.',
    priority: 'low',
  },
  vitals_update: {
    title: 'Health data update',
    body: 'New vital readings were received. Tap to view your latest health data.',
  },
};

const ANDROID_CHANNEL_BY_CATEGORY: Readonly<Record<NotificationCategory, string>> = {
  account_security: 'system',
  appointments: 'appointments',
  consultations: 'medical',
  messages: 'messages',
  prescriptions: 'medical',
  vitals_alerts: 'medical',
  ai_review: 'system',
  delivery: 'appointments',
  dispatch: 'appointments',
  emergency: 'emergency',
  system: 'system',
  vitals_update: 'medical',
};

/**
 * Renders the delivery copy for a notification work row. Resolution order:
 * exact title-code entry → category fallback. Priority resolution is the same,
 * so an entry may override the category default (a reminder is high while a
 * confirmation is normal).
 */
export function renderNotificationCopy(work: NotificationCopyWork): RenderedNotificationCopy {
  const entry = COPY_BY_TITLE_CODE[work.titleCode] ?? CATEGORY_FALLBACK[work.category];
  const fallback = CATEGORY_FALLBACK[work.category];
  return Object.freeze({
    title: entry.title,
    body: entry.body,
    priority: entry.priority ?? fallback.priority ?? 'normal',
    deepLink: deepLinkForResource(work.resourceType, work.resourceId),
    androidChannel: ANDROID_CHANNEL_BY_CATEGORY[work.category],
  });
}
