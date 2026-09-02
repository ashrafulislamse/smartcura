import 'dart:ui';

import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../theme/app_colors.dart';

/// Client-side copy catalogue for notification title/body codes.
///
/// The backend stores `title_code`/`body_code` (e.g.
/// `appointment.requested.title` / `appointment.requested.body`) — never prose
/// — so PHI stays out of the row and each app can localise. This catalogue
/// mirrors the worker's server-side catalogue
/// (`apps/api/apps/worker/src/notification-copy.ts`): the codes are the stable
/// contract, the wording must stay in sync with the server's push previews.
///
/// Lookup accepts either the bare code (`appointment.requested`) or the stored
/// title/body form (`appointment.requested.title`) — the `.title`/`.body`
/// suffix is stripped before lookup.
class NotificationCopy {
  const NotificationCopy._({
    required this.title,
    required this.body,
  });

  final String title;
  final String body;

  /// Fallback for codes this app does not know.
  static const unknown = NotificationCopy._(
    title: 'SmartCura update',
    body: 'Tap to view the details.',
  );

  /// Doctor-relevant codes. Patient-only codes (pharmacy delivery, dispatch
  /// offers, emergency patient updates) are intentionally absent — the doctor
  /// app never receives them, and an unknown code renders [unknown].
  static const Map<String, NotificationCopy> _byCode = {
    // Appointments (doctor-facing).
    'appointment.requested': NotificationCopy._(
      title: 'New appointment request',
      body:
          'A patient requested an appointment with you. Tap to review and confirm or decline it.',
    ),
    'appointment.cancelled_by_patient': NotificationCopy._(
      title: 'Appointment cancelled',
      body:
          'An appointment booked with you was cancelled by the patient. Tap to view the freed slot.',
    ),
    'appointment.rescheduled': NotificationCopy._(
      title: 'Appointment rescheduled',
      body: 'An appointment time changed. Tap to view the new date and time.',
    ),
    'appointment.reminder': NotificationCopy._(
      title: 'Appointment reminder',
      body:
          'You have an appointment in the next 24 hours. Tap to view the details.',
    ),
    'appointment.completed': NotificationCopy._(
      title: 'Appointment completed',
      body:
          'Your appointment has been marked as completed. Tap to view the summary.',
    ),
    'appointment.no_show': NotificationCopy._(
      title: 'Appointment missed',
      body:
          'You were marked as absent for your appointment. Tap to view the details and rebook.',
    ),
    // Consultations.
    'consultation.ready': NotificationCopy._(
      title: 'Consultation ready',
      body:
          'A consultation is ready to join. Tap to enter the consultation room.',
    ),
    'consultation.completed': NotificationCopy._(
      title: 'Consultation completed',
      body:
          'A consultation has been completed. Tap to view the summary and any prescriptions.',
    ),
    'consultation.cancelled': NotificationCopy._(
      title: 'Consultation cancelled',
      body: 'A consultation was cancelled. Tap to view the details.',
    ),
    // Messages.
    'message.new': NotificationCopy._(
      title: 'New message',
      body: 'You have a new message in a conversation. Tap to read and reply.',
    ),
    // Prescriptions (the doctor is usually the actor; mapped for parity).
    'prescription.ready': NotificationCopy._(
      title: 'Prescription ready',
      body:
          'A prescription issued to you is ready. Tap to view it and order from the pharmacy.',
    ),
    'prescription.cancelled': NotificationCopy._(
      title: 'Prescription cancelled',
      body:
          'A prescription issued to you was cancelled by the issuing doctor. Tap to view the details.',
    ),
    // Health alerts (doctor-facing).
    'health.alert.raised': NotificationCopy._(
      title: 'Critical vitals alert',
      body:
          'A monitoring alert was raised for a patient assigned to you. Tap to review the readings.',
    ),
    // Verification.
    'verification.approved': NotificationCopy._(
      title: 'Verification approved',
      body: 'Your verification document was approved. Tap to view the outcome.',
    ),
    'verification.rejected': NotificationCopy._(
      title: 'Verification not approved',
      body:
          "Your verification document was not approved. Tap to view the reviewer's note.",
    ),
    'verification.changes_requested': NotificationCopy._(
      title: 'Verification changes requested',
      body:
          'A reviewer asked for changes to your verification document. Tap to view what is needed.',
    ),
    // Emergency.
    'emergency.created': NotificationCopy._(
      title: 'Emergency request',
      body:
          'A new emergency request needs operator attention. Tap to open the emergency console.',
    ),
  };

  /// Resolves copy for a title/body code. Accepts `appointment.requested`,
  /// `appointment.requested.title` and `appointment.requested.body` alike —
  /// title and body codes share one entry because the catalogue owns both
  /// halves of the copy.
  static NotificationCopy forCode(String? code) {
    if (code == null || code.isEmpty) return unknown;
    var key = code;
    if (key.endsWith('.title') || key.endsWith('.body')) {
      key = key.substring(0, key.lastIndexOf('.'));
    }
    return _byCode[key] ?? unknown;
  }
}

/// Priority → accent colour for chips, badges and notification styling.
///
/// critical → red, high → orange, normal → blue-grey, low → grey. `unknown`
/// renders like normal (blue-grey) — it is a decode fallback, not a state.
Color notificationPriorityColor(NotificationPriority priority) {
  switch (priority) {
    case NotificationPriority.critical:
      return AppColors.error;
    case NotificationPriority.high:
      return AppColors.warning;
    case NotificationPriority.low:
      return AppColors.gray500;
    case NotificationPriority.normal:
    case NotificationPriority.unknown:
      return AppColors.gray600;
  }
}

/// Priority → short uppercase label for chips.
String notificationPriorityLabel(NotificationPriority priority) {
  switch (priority) {
    case NotificationPriority.critical:
      return 'CRITICAL';
    case NotificationPriority.high:
      return 'HIGH';
    case NotificationPriority.normal:
      return 'NORMAL';
    case NotificationPriority.low:
      return 'LOW';
    case NotificationPriority.unknown:
      return 'NORMAL';
  }
}
