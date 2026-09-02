/// Barrel file for the driver app's shared widget library.
///
/// Import `package:smartcura_driver_app/core/widgets/widgets.dart` to access
/// every shared widget, the state/empty/error views, and the design-system
/// primitives ported from the patient app.
library;

// Existing driver-app widgets.
export 'animated_counter.dart';
export 'app_snackbar.dart';
export 'shimmer_loader.dart';

// Ported design-system widgets.
export 'state_view.dart';
export 'status_badge.dart';
export 'stat_card.dart';
export 'premium_card.dart';
export 'loading_overlay.dart';
export 'search_bar_widget.dart';
export 'filter_chips_widget.dart';
export 'refresh_list_widget.dart';
export 'avatar_widget.dart';
export 'auth_widgets.dart';

// Ported widgets in sub-folders.
export 'buttons/primary_button.dart';
export 'inputs/custom_text_field.dart';
export 'inputs/password_field.dart';
