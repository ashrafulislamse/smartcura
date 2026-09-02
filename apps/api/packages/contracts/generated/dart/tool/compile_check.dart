import '../lib/smartcura_contracts.dart';

void main() {
  final fallback = roleIdFromWire('future_role');
  if (fallback != RoleId.unknown) {
    throw StateError('Unknown enum values must decode to RoleId.unknown');
  }
  if (RoleId.patient.wireValue != 'patient') {
    throw StateError('Known enum values must retain their wire values');
  }
  var rejectedSyntheticUnknown = false;
  try {
    RoleId.unknown.wireValue;
  } on StateError {
    rejectedSyntheticUnknown = true;
  }
  if (!rejectedSyntheticUnknown) {
    throw StateError('Synthetic unknown enum values must not serialize');
  }
}
