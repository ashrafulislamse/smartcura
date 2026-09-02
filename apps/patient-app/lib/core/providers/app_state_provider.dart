import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import 'doctor_provider.dart';

// NOTE: The old AuthState / AuthStateNotifier that lived here has been replaced
// by lib/core/auth/auth_provider.dart (AuthNotifier, AuthState, AuthStatus).
// Import auth_provider.dart instead of this file for authentication state.
//
// The booking flow state remains here because it is a UI concern (selected
// doctor, date, time, consultation type) rather than an auth concern.

// ---------------------------------------------------------------------------
// Selected entities for the booking flow
// ---------------------------------------------------------------------------

/// The currently selected appointment (for detail / reschedule screens).
final selectedAppointmentProvider =
    StateProvider<Appointment?>((ref) => null);

// ---------------------------------------------------------------------------
// Booking state
// ---------------------------------------------------------------------------

/// Mutable booking wizard state. The doctor is typed as the real contract
/// type [DoctorDirectoryItem] so the booking screen can read real fields
/// (consultationFeeSen, currency, membershipId, etc.) instead of mock doubles.
class BookingState {
  final DoctorDirectoryItem? doctor;
  final DateTime? selectedDate;
  final String? selectedSlotId;
  final AppointmentMode? consultationMode;
  final String? notes;

  const BookingState({
    this.doctor,
    this.selectedDate,
    this.selectedSlotId,
    this.consultationMode,
    this.notes,
  });

  BookingState copyWith({
    DoctorDirectoryItem? doctor,
    DateTime? selectedDate,
    String? selectedSlotId,
    AppointmentMode? consultationMode,
    String? notes,
  }) {
    return BookingState(
      doctor: doctor ?? this.doctor,
      selectedDate: selectedDate ?? this.selectedDate,
      selectedSlotId: selectedSlotId ?? this.selectedSlotId,
      consultationMode: consultationMode ?? this.consultationMode,
      notes: notes ?? this.notes,
    );
  }
}

final bookingStateProvider =
    StateNotifierProvider<BookingStateNotifier, BookingState>((ref) {
  return BookingStateNotifier();
});

class BookingStateNotifier extends StateNotifier<BookingState> {
  BookingStateNotifier() : super(const BookingState());

  void setDoctor(DoctorDirectoryItem doctor) {
    state = state.copyWith(doctor: doctor);
  }

  void setDate(DateTime date) {
    state = state.copyWith(selectedDate: date);
  }

  void setSlot(String slotId) {
    state = state.copyWith(selectedSlotId: slotId);
  }

  void setConsultationMode(AppointmentMode mode) {
    state = state.copyWith(consultationMode: mode);
  }

  /// Legacy setter that accepts a string ('video', 'audio', 'in_person', 'chat')
  /// and maps it to the contract enum. Kept so existing screens that pass a
  /// string can compile until Phase 2 updates them.
  void setConsultationType(String type) {
    final mode = switch (type) {
      'video' => AppointmentMode.video,
      'audio' => AppointmentMode.audio,
      'in_person' || 'in-person' => AppointmentMode.inPerson,
      'chat' => AppointmentMode.chat,
      _ => AppointmentMode.video,
    };
    state = state.copyWith(consultationMode: mode);
  }

  void setNotes(String notes) {
    state = state.copyWith(notes: notes);
  }

  void reset() {
    state = const BookingState();
  }
}
