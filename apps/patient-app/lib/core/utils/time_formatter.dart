import 'package:intl/intl.dart';

/// Formats an ISO-8601 timestamp as a human-readable relative instant
/// ("just now", "4 min ago", "2 h ago", then a short date).
///
/// Used by the home health-status card ("Updated 2 min ago") and the recent
/// activity rows so every relative label in the app comes from one place.
String formatRelativeTime(String iso, {DateTime? now}) {
  final dt = DateTime.tryParse(iso);
  if (dt == null) return '';
  final reference = now ?? DateTime.now();
  final diff = reference.difference(dt);
  if (diff.isNegative || diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  if (diff.inDays == 1) return 'yesterday';
  return DateFormat('d MMM').format(dt);
}

/// Short date for activity rows, e.g. "12 Aug 2026".
String formatShortDate(String iso) {
  final dt = DateTime.tryParse(iso);
  if (dt == null) return iso;
  return DateFormat('d MMM yyyy').format(dt);
}

/// Wall-clock time ("10:30") plus its day-part ("AM") for timeline rails.
(String time, String dayPart) formatTimeParts(String iso) {
  final dt = DateTime.tryParse(iso);
  if (dt == null) return (iso, '');
  final time = DateFormat('h:mm').format(dt);
  final dayPart = DateFormat('a').format(dt);
  return (time, dayPart);
}
