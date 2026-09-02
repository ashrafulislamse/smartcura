import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../providers/appointment_provider.dart';
import '../providers/doctor_provider.dart';

/// Checks the patient in (when needed) and launches the consultation room
/// for [appointment].
///
/// Mirrors the join flow in `AppointmentDetailsScreen` so the home screen's
/// Join CTAs behave exactly like the detail screen's: check-in first, then
/// push the video/audio room route with the doctor context the room screen
/// expects.
Future<void> launchConsultation(
  BuildContext context,
  WidgetRef ref,
  Appointment appointment,
) async {
  final status = appointment.status;

  // If already checked in or in progress, skip the check-in API call.
  if (status != AppointmentStatus.checkedIn &&
      status != AppointmentStatus.inProgress) {
    try {
      await ref.read(apiClientProvider).put<dynamic>(
        ApiEndpoints.appointmentStatus(appointment.id),
        data: {
          'status': 'checked_in',
          'expected_version': appointment.version,
        },
      );
      // The status changed server-side; refresh every home surface that
      // projects it so the CTA does not offer a stale action.
      ref.invalidate(appointmentsProvider);
      ref.invalidate(nextAppointmentProvider);
      ref.invalidate(appointmentDetailProvider(appointment.id));
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Check-in failed: ${_errorMessage(e)}'),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
      return;
    }
  }

  final doctorAsync =
      ref.read(doctorDetailProvider(appointment.doctorMembershipId));
  final doctorName =
      doctorAsync.whenOrNull(data: (d) => d.displayName) ?? 'Doctor';
  final specialty =
      doctorAsync.whenOrNull(data: (d) => d.primarySpecialty) ?? '';

  final route = appointment.mode == AppointmentMode.audio
      ? '/audio-consultation'
      : '/video-consultation';

  if (!context.mounted) return;
  context.push(route, extra: {
    'appointmentId': appointment.id,
    'doctorName': doctorName,
    'specialty': specialty,
  });
}

String _errorMessage(Object? error) {
  try {
    final m = (error as dynamic).userMessage;
    if (m is String && m.isNotEmpty) return m;
  } catch (_) {}
  return error.toString();
}
