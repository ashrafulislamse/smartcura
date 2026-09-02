import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Client-side mirror of the server's notification catalogue
/// (`apps/api/apps/worker/src/notification-copy.ts`).
///
/// Codes are the stable contract: the notifications table stores
/// `title_code`/`body_code` (never prose) and the FCM payload repeats them, so
/// this catalogue turns `<event>.title` / `<event>.body` into the copy the
/// user reads. Keep the strings in sync with the server — the copy there is
/// the single source of truth (and is PHI-constrained: kinds and times only).
class NotificationCopy {
  const NotificationCopy({required this.title, required this.body});

  final String title;
  final String body;
}

/// Fallback for codes the client does not know. A code can be newer than the
/// installed app, so this must stay friendly rather than leak the raw code.
const NotificationCopy genericNotificationCopy = NotificationCopy(
  title: 'SmartCura update',
  body: 'Tap to view the details.',
);

/// Patient-relevant title codes → copy. Mirrors COPY_BY_TITLE_CODE minus the
/// doctor/driver-only entries (dispatch.*, appointment.requested,
/// health.alert.raised, emergency.created) that this app never renders.
const Map<String, NotificationCopy> _copyByEventCode = {
  // messages
  'message.new': NotificationCopy(
    title: 'New message',
    body: 'You have a new message in a conversation. '
        'Tap to read and reply.',
  ),
  // prescriptions
  'prescription.ready': NotificationCopy(
    title: 'Prescription ready',
    body: 'A prescription issued to you is ready. '
        'Tap to view it and order from the pharmacy.',
  ),
  'prescription.cancelled': NotificationCopy(
    title: 'Prescription cancelled',
    body: 'A prescription issued to you was cancelled by the issuing doctor. '
        'Tap to view the details.',
  ),
  // appointments
  'appointment.confirmed': NotificationCopy(
    title: 'Appointment confirmed',
    body: 'Your appointment is confirmed. '
        'Tap to view the date, time and joining instructions.',
  ),
  'appointment.cancelled_by_doctor': NotificationCopy(
    title: 'Appointment cancelled',
    body: 'Your appointment was cancelled by the doctor. '
        'Tap to view the reason and rebook.',
  ),
  'appointment.cancelled_by_patient': NotificationCopy(
    title: 'Appointment cancelled',
    body: 'An appointment booked with you was cancelled by the patient. '
        'Tap to view the freed slot.',
  ),
  'appointment.rescheduled': NotificationCopy(
    title: 'Appointment rescheduled',
    body: 'An appointment time changed. Tap to view the new date and time.',
  ),
  'appointment.reminder': NotificationCopy(
    title: 'Appointment reminder',
    body: 'You have an appointment in the next 24 hours. '
        'Tap to view the details.',
  ),
  'appointment.completed': NotificationCopy(
    title: 'Appointment completed',
    body: 'Your appointment has been marked as completed. '
        'Tap to view the summary.',
  ),
  'appointment.no_show': NotificationCopy(
    title: 'Appointment missed',
    body: 'You were marked as absent for your appointment. '
        'Tap to view the details and rebook.',
  ),
  // consultations
  'consultation.ready': NotificationCopy(
    title: 'Consultation ready',
    body:
        'A consultation is ready to join. Tap to enter the consultation room.',
  ),
  'consultation.completed': NotificationCopy(
    title: 'Consultation completed',
    body: 'A consultation has been completed. '
        'Tap to view the summary and any prescriptions.',
  ),
  'consultation.cancelled': NotificationCopy(
    title: 'Consultation cancelled',
    body: 'A consultation was cancelled. Tap to view the details.',
  ),
  // pharmacy delivery
  'pharmacy_order.ready_for_dispatch': NotificationCopy(
    title: 'Order ready for dispatch',
    body: 'Your pharmacy order is packed and awaiting a driver. '
        'Tap to track the order.',
  ),
  'pharmacy_order.dispatched': NotificationCopy(
    title: 'Order on its way',
    body: 'Your pharmacy order has been picked up for delivery. '
        'Tap to track the delivery.',
  ),
  'pharmacy_order.delivered': NotificationCopy(
    title: 'Order delivered',
    body: 'Your pharmacy order was delivered. '
        'Tap to view the order and proof of delivery.',
  ),
  'pharmacy_order.cancelled': NotificationCopy(
    title: 'Order cancelled',
    body: 'A pharmacy order was cancelled. Tap to view the order details.',
  ),
  // verification
  'verification.approved': NotificationCopy(
    title: 'Verification approved',
    body: 'Your verification document was approved. Tap to view the outcome.',
  ),
  'verification.rejected': NotificationCopy(
    title: 'Verification not approved',
    body: 'Your verification document was not approved. '
        "Tap to view the reviewer's note.",
  ),
  'verification.changes_requested': NotificationCopy(
    title: 'Verification changes requested',
    body: 'A reviewer asked for changes to your verification document. '
        'Tap to view what is needed.',
  ),
  // emergency
  'emergency.resolved': NotificationCopy(
    title: 'Emergency resolved',
    body: 'Your emergency request has been resolved. Tap to view the outcome.',
  ),
  'emergency.cancelled': NotificationCopy(
    title: 'Emergency cancelled',
    body: 'Your emergency request was cancelled. Tap to view the details.',
  ),
  // vitals
  'vitals.received': NotificationCopy(
    title: 'New health data',
    body: 'New vital readings were received from your device. '
        'Tap to view your latest health data.',
  ),
};

/// Resolves copy for a `title_code`/`body_code`. The wire stores codes as
/// `<event>.title` / `<event>.body`; a bare `<event>` (FCM `title_code` may
/// be normalised by some senders) maps to the same entry. Unknown → generic.
NotificationCopy copyForCode(String? code) {
  if (code == null || code.isEmpty) {
    return genericNotificationCopy;
  }
  var event = code;
  if (event.endsWith('.title') || event.endsWith('.body')) {
    event = event.substring(0, event.lastIndexOf('.'));
  }
  return _copyByEventCode[event] ?? genericNotificationCopy;
}

/// Human-readable label for a priority wire value
/// ('low'|'normal'|'high'|'critical'). Unknown/null reads as Normal — the
/// server default.
String priorityLabel(String? priority) {
  switch (priority) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'low':
      return 'Low';
    case 'normal':
    default:
      return 'Normal';
  }
}

/// Chip colour for a priority wire value: critical → red, high → orange,
/// normal → blue-grey, low → grey.
Color priorityColor(String? priority) {
  switch (priority) {
    case 'critical':
      return AppColors.error;
    case 'high':
      return AppColors.warning;
    case 'low':
      return AppColors.gray500;
    case 'normal':
    default:
      // Slate-500 — blue-grey, distinct from the neutral greys of `low`.
      return const Color(0xFF64748B);
  }
}
