import 'package:flutter/material.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../theme/app_colors.dart';

/// One rendered copy entry: what the user reads for a title code.
class NotificationCopyEntry {
  const NotificationCopyEntry({required this.title, required this.body});
  final String title;
  final String body;
}

/// Client-side mirror of the worker's `notification-copy.ts` catalogue, kept to
/// the codes a driver can actually receive. The backend stores i18n codes
/// (`title_code`/`body_code`), not prose — this catalogue turns them into the
/// English copy the notifications list renders. The wording is copied verbatim
/// from the server catalogue so a push preview and the in-app row say the same
/// thing.
///
/// Codes arrive with a `.title` or `.body` suffix (`dispatch.offer.title`,
/// `dispatch.assignment.body`); [NotificationCopy.forCode] strips it, so one
/// entry per base code covers both.
class NotificationCopy {
  NotificationCopy._();

  /// Copy for codes the driver app has a screen or a workflow for. Keep in
  /// sync with `apps/api/apps/worker/src/notification-copy.ts`.
  static const Map<String, NotificationCopyEntry> _byCode = {
    // Dispatch — the driver's own workflow.
    'dispatch.offer': NotificationCopyEntry(
      title: 'New delivery offer',
      body:
          'A delivery is available near you. Tap to review the fee and accept or decline it.',
    ),
    'dispatch.assignment': NotificationCopyEntry(
      title: 'Delivery assignment update',
      body:
          'The status of a delivery assigned to you changed. Tap to view the assignment.',
    ),
    // Pharmacy orders — the driver carries them, so the workflow codes stay.
    'pharmacy_order.ready_for_dispatch': NotificationCopyEntry(
      title: 'Order ready for dispatch',
      body:
          'Your pharmacy order is packed and awaiting a driver. Tap to track the order.',
    ),
    'pharmacy_order.dispatched': NotificationCopyEntry(
      title: 'Order on its way',
      body:
          'Your pharmacy order has been picked up for delivery. Tap to track the delivery.',
    ),
    'pharmacy_order.delivered': NotificationCopyEntry(
      title: 'Order delivered',
      body:
          'Your pharmacy order was delivered. Tap to view the order and proof of delivery.',
    ),
    'pharmacy_order.cancelled': NotificationCopyEntry(
      title: 'Order cancelled',
      body: 'A pharmacy order was cancelled. Tap to view the order details.',
    ),
    // Messages.
    'message.new': NotificationCopyEntry(
      title: 'New message',
      body: 'You have a new message in a conversation. Tap to read and reply.',
    ),
    // Driver document verification.
    'verification.approved': NotificationCopyEntry(
      title: 'Verification approved',
      body: 'Your verification document was approved. Tap to view the outcome.',
    ),
    'verification.rejected': NotificationCopyEntry(
      title: 'Verification not approved',
      body:
          "Your verification document was not approved. Tap to view the reviewer's note.",
    ),
    'verification.changes_requested': NotificationCopyEntry(
      title: 'Verification changes requested',
      body:
          'A reviewer asked for changes to your verification document. Tap to view what is needed.',
    ),
    // Emergency dispatch.
    'emergency.created': NotificationCopyEntry(
      title: 'Emergency request',
      body:
          'A new emergency request needs operator attention. Tap to open the emergency console.',
    ),
    // Appointment codes can reach a driver via shared delivery slots; the
    // wording stays the server's.
    'appointment.confirmed': NotificationCopyEntry(
      title: 'Appointment confirmed',
      body:
          'Your appointment is confirmed. Tap to view the date, time and joining instructions.',
    ),
    'appointment.cancelled_by_patient': NotificationCopyEntry(
      title: 'Appointment cancelled',
      body:
          'An appointment booked with you was cancelled by the patient. Tap to view the freed slot.',
    ),
    'appointment.cancelled_by_doctor': NotificationCopyEntry(
      title: 'Appointment cancelled',
      body:
          'Your appointment was cancelled by the doctor. Tap to view the reason and rebook.',
    ),
    'appointment.rescheduled': NotificationCopyEntry(
      title: 'Appointment rescheduled',
      body: 'An appointment time changed. Tap to view the new date and time.',
    ),
    'appointment.reminder': NotificationCopyEntry(
      title: 'Appointment reminder',
      body:
          'You have an appointment in the next 24 hours. Tap to view the details.',
    ),
    'appointment.requested': NotificationCopyEntry(
      title: 'New appointment request',
      body:
          'A patient requested an appointment with you. Tap to review and confirm or decline it.',
    ),
  };

  /// Fallback for codes this catalogue does not know. Never leak the raw code
  /// into the UI.
  static const NotificationCopyEntry _fallback = NotificationCopyEntry(
    title: 'SmartCura update',
    body: 'Tap to view the details.',
  );

  /// Resolve a `title_code` or `body_code` wire value to display copy. The
  /// `.title`/`.body` suffix is normalised away first so both halves of a
  /// notification map to the same entry.
  static NotificationCopyEntry forCode(String? code) {
    if (code == null || code.isEmpty) return _fallback;
    var key = code;
    for (final suffix in const ['.title', '.body']) {
      if (key.endsWith(suffix)) {
        key = key.substring(0, key.length - suffix.length);
        break;
      }
    }
    return _byCode[key] ?? _fallback;
  }

  // ---------------------------------------------------------------------------
  // Priority → colour
  // ---------------------------------------------------------------------------

  /// Slate-500 — the palette has no blue-grey token and `normal` must read as
  /// calmer than the brand blue used by `high`-adjacent UI.
  static const Color _normalPriority = Color(0xFF64748B);

  /// Colour for a notification priority wire value (the FCM `data.priority`).
  /// Unknown/absent values render as low-importance grey.
  static Color priorityColorFromWire(String? wire) =>
      priorityColor(notificationPriorityFromWire(wire ?? ''));

  /// Colour for a decoded [NotificationPriority] (the list payload).
  static Color priorityColor(NotificationPriority priority) => switch (priority) {
        NotificationPriority.critical => AppColors.emergency, // red
        NotificationPriority.high => AppColors.warning, // orange
        NotificationPriority.normal => _normalPriority, // blue-grey
        NotificationPriority.low || NotificationPriority.unknown =>
          AppColors.gray400, // grey
      };

  /// Short label for the priority chip.
  static String priorityLabel(NotificationPriority priority) => switch (priority) {
        NotificationPriority.critical => 'Critical',
        NotificationPriority.high => 'High',
        NotificationPriority.normal => 'Normal',
        NotificationPriority.low => 'Low',
        NotificationPriority.unknown => 'Info',
      };
}
