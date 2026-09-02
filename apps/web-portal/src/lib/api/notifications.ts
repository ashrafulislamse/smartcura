/**
 * The caller's own in-app notifications.
 *
 * SCOPE IS THE SESSION, never a parameter: the repository filters by the profile id
 * the session proves, so there is no request field that can widen the list. The
 * same is true of the read mutations — one account can never touch another's rows.
 *
 * LISTS ARE CURSOR-PAGINATED, ordered newest first, and the optional `category` and
 * `unread` filters are evaluated server-side; a client-side filter would only ever
 * see the current page and silently miscount.
 */

import type { Notification, NotificationCategory, NotificationList } from '@/types/contracts';
import { apiRequest } from './client';

export type { Notification, NotificationCategory };

const CATEGORIES: readonly NotificationCategory[] = [
  'account_security', 'appointments', 'consultations', 'messages', 'prescriptions',
  'vitals_alerts', 'ai_review', 'delivery', 'emergency', 'system',
] as const;

export function listNotifications(options: {
  category?: NotificationCategory;
  unread?: boolean;
  cursor?: string;
  pageSize?: number;
  signal?: AbortSignal;
} = {}): Promise<NotificationList> {
  const params = new URLSearchParams();
  if (options.category !== undefined) params.set('category', options.category);
  if (options.unread !== undefined) params.set('unread', options.unread ? 'true' : 'false');
  if (options.cursor !== undefined) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return apiRequest<NotificationList>({ method: 'GET', path: `/notifications${query}`, signal: options.signal });
}

export function markNotificationRead(notificationId: string): Promise<Notification> {
  return apiRequest<Notification>({
    method: 'PUT',
    path: `/notifications/${notificationId}/read`,
    csrf: true,
  });
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiRequest<{ updated: number }>({
    method: 'PUT',
    path: '/notifications/read-all',
    csrf: true,
  });
}

/**
 * A portal route for a notification's resource, when one exists. The map is the
 * web twin of the mobile deep-link table: only entities with a real page behind
 * them get links, and the authorization is whatever the target page's endpoint
 * enforces — a link is never an access grant.
 */
export function resourceHref(notification: Notification): string | null {
  switch (notification.resource_type) {
    case 'appointment':
      return `/appointments/${notification.resource_id}`;
    case 'prescription':
      return `/doctor/prescriptions/${notification.resource_id}`;
    case 'pharmacy_order':
      return `/pharmacy/orders/${notification.resource_id}`;
    case 'verification_document':
      return `/users/verification/${notification.resource_id}`;
    default:
      return null;
  }
}

/**
 * Title-code → human copy, mirroring the worker's server-side catalogue
 * (apps/api/apps/worker/src/notification-copy.ts). The row carries codes, not
 * prose, so the client renders the wording; keeping the two catalogues in step
 * is asserted by the backend suite's copy tests.
 */
const COPY: Readonly<Record<string, string>> = {
  'message.new.title': 'New message',
  'prescription.ready.title': 'Prescription ready',
  'prescription.cancelled.title': 'Prescription cancelled',
  'appointment.confirmed.title': 'Appointment confirmed',
  'appointment.cancelled_by_patient.title': 'Appointment cancelled by patient',
  'appointment.cancelled_by_doctor.title': 'Appointment cancelled',
  'appointment.rescheduled.title': 'Appointment rescheduled',
  'appointment.reminder.title': 'Appointment reminder',
  'appointment.requested.title': 'New appointment request',
  'pharmacy_order.ready_for_dispatch.title': 'Order ready for dispatch',
  'pharmacy_order.dispatched.title': 'Order on its way',
  'pharmacy_order.delivered.title': 'Order delivered',
  'pharmacy_order.cancelled.title': 'Order cancelled',
  'dispatch.offer.title': 'New delivery offer',
  'dispatch.assignment.title': 'Delivery assignment update',
  'verification.approved.title': 'Verification approved',
  'verification.rejected.title': 'Verification not approved',
  'verification.changes_requested.title': 'Verification changes requested',
  'health.alert.raised.title': 'Critical vitals alert',
  'emergency.created.title': 'Emergency request',
  'emergency.resolved.title': 'Emergency resolved',
  'emergency.cancelled.title': 'Emergency cancelled',
};

export function notificationTitle(notification: Notification): string {
  return COPY[notification.title_code] ?? notification.title_code.replace(/\.title$/, '').replace(/[_.]/g, ' ');
}

export { CATEGORIES as NOTIFICATION_CATEGORIES };
