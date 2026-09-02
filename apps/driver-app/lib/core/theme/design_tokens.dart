import 'package:flutter/painting.dart';

import 'app_colors.dart';

/// Design tokens for consistent UI.
///
/// All durations, z-indices, line heights, letter spacing, and elevation
/// values are declared here so a widget never invents a magic number. Ported
/// from the patient app — this file is domain-agnostic.
class DesignTokens {
  DesignTokens._();

  // ---------------------------------------------------------------------------
  // Spacing (4px base unit)
  // ---------------------------------------------------------------------------
  static const double spaceXs = 4;
  static const double spaceSm = 8;
  static const double spaceMd = 16;
  static const double spaceLg = 24;
  static const double spaceXl = 32;
  static const double spaceXxl = 48;
  static const double spaceXxxl = 64;

  // ---------------------------------------------------------------------------
  // Border Radius
  // ---------------------------------------------------------------------------
  static const double radiusXs = 4;
  static const double radiusSm = 8;
  static const double radiusMd = 12;
  static const double radiusLg = 16;
  static const double radiusXl = 20;
  static const double radiusXxl = 24;
  static const double radiusFull = 9999; // Pill shape

  // ---------------------------------------------------------------------------
  // Elevation Scale (Shadow)
  // ---------------------------------------------------------------------------
  static const double elevationNone = 0;
  static const double elevationXs = 1;
  static const double elevationSm = 2;
  static const double elevationMd = 4;
  static const double elevationLg = 8;
  static const double elevationXl = 16;

  // ---------------------------------------------------------------------------
  // Icon Sizes
  // ---------------------------------------------------------------------------
  static const double iconXs = 16;
  static const double iconSm = 20;
  static const double iconMd = 24;
  static const double iconLg = 32;
  static const double iconXl = 48;

  // ---------------------------------------------------------------------------
  // Touch Targets (Minimum 48x48px for accessibility)
  // ---------------------------------------------------------------------------
  static const double touchTargetMin = 48;

  // ---------------------------------------------------------------------------
  // Button Heights
  // ---------------------------------------------------------------------------
  static const double buttonHeightSm = 40;
  static const double buttonHeightMd = 48;
  static const double buttonHeightLg = 56;

  // ---------------------------------------------------------------------------
  // Input Height
  // ---------------------------------------------------------------------------
  static const double inputHeight = 56;

  // ---------------------------------------------------------------------------
  // Bottom Navigation
  // ---------------------------------------------------------------------------
  static const double bottomNavHeight = 64;

  // ---------------------------------------------------------------------------
  // App Bar
  // ---------------------------------------------------------------------------
  static const double appBarHeight = 56;

  // ---------------------------------------------------------------------------
  // Card
  // ---------------------------------------------------------------------------
  static const double cardPadding = 16;
  static const double cardMargin = 8;

  // ---------------------------------------------------------------------------
  // Screen Padding
  // ---------------------------------------------------------------------------
  static const double screenPaddingHorizontal = 16;
  static const double screenPaddingVertical = 16;

  // ---------------------------------------------------------------------------
  // Animation Durations
  // ---------------------------------------------------------------------------
  static const int animDurationFastMs = 150;
  static const int animDurationMediumMs = 300;
  static const int animDurationSlowMs = 500;

  static const Duration animDurationFast =
      Duration(milliseconds: animDurationFastMs);
  static const Duration animDurationMedium =
      Duration(milliseconds: animDurationMediumMs);
  static const Duration animDurationSlow =
      Duration(milliseconds: animDurationSlowMs);

  // ---------------------------------------------------------------------------
  // Transition Durations
  // ---------------------------------------------------------------------------
  static const Duration transitionDurationFast = Duration(milliseconds: 100);
  static const Duration transitionDurationMedium = Duration(milliseconds: 200);
  static const Duration transitionDurationSlow = Duration(milliseconds: 400);

  // ---------------------------------------------------------------------------
  // Z-Index (for stacking overlays, sheets, dialogs)
  // ---------------------------------------------------------------------------
  static const int zIndexBase = 0;
  static const int zIndexContent = 1;
  static const int zIndexSticky = 100;
  static const int zIndexHeader = 200;
  static const int zIndexOverlay = 300;
  static const int zIndexModal = 400;
  static const int zIndexToast = 500;

  // ---------------------------------------------------------------------------
  // Line Heights (multiplier on font size)
  // ---------------------------------------------------------------------------
  static const double lineHeightTight = 1.2;
  static const double lineHeightNormal = 1.5;
  static const double lineHeightRelaxed = 1.75;

  // ---------------------------------------------------------------------------
  // Letter Spacing
  // ---------------------------------------------------------------------------
  static const double letterSpacingTight = -0.5;
  static const double letterSpacingNormal = 0;
  static const double letterSpacingWide = 0.5;
  static const double letterSpacingWider = 1.0;

  // ---------------------------------------------------------------------------
  // Opacity (Material 3 state-layer values)
  // ---------------------------------------------------------------------------
  static const double opacityDisabled = 0.38;
  static const double opacityHover = 0.04;
  static const double opacityFocus = 0.12;
  static const double opacitySelected = 0.08;

  // ---------------------------------------------------------------------------
  // Border Width
  // ---------------------------------------------------------------------------
  static const double borderWidthThin = 1;
  static const double borderWidthMedium = 2;
  static const double borderWidthThick = 4;

  // ---------------------------------------------------------------------------
  // Divider
  // ---------------------------------------------------------------------------
  static const double dividerThickness = 1;

  // ---------------------------------------------------------------------------
  // Avatar Sizes
  // ---------------------------------------------------------------------------
  static const double avatarSm = 32;
  static const double avatarMd = 48;
  static const double avatarLg = 64;
  static const double avatarXl = 96;

  // ---------------------------------------------------------------------------
  // Badge Sizes
  // ---------------------------------------------------------------------------
  static const double badgeSm = 16;
  static const double badgeMd = 20;
  static const double badgeLg = 24;

  // ---------------------------------------------------------------------------
  // Max Widths (for responsive design)
  // ---------------------------------------------------------------------------
  static const double maxWidthXs = 480;
  static const double maxWidthSm = 600;
  static const double maxWidthMd = 768;
  static const double maxWidthLg = 1024;
  static const double maxWidthXl = 1280;

  // ---------------------------------------------------------------------------
  // Breakpoints
  // ---------------------------------------------------------------------------
  static const double breakpointXs = 0;
  static const double breakpointSm = 576;
  static const double breakpointMd = 768;
  static const double breakpointLg = 992;
  static const double breakpointXl = 1200;
}

/// Box-shadow presets for cards and floating surfaces.
///
/// Use the static getters to apply a consistent shadow without re-typing magic
/// numbers, e.g. `boxShadow: BoxShadowPreset.card`.
class BoxShadowPreset {
  BoxShadowPreset._();

  /// Soft shadow for standard cards.
  static List<BoxShadow> get card => const [
        BoxShadow(
          color: AppColors.shadow,
          blurRadius: 8,
          offset: Offset(0, 2),
        ),
      ];

  /// Medium shadow for elevated / sticky cards.
  static List<BoxShadow> get elevated => const [
        BoxShadow(
          color: AppColors.shadow,
          blurRadius: 16,
          offset: Offset(0, 4),
        ),
      ];

  /// Strong shadow for floating elements (FAB, dialogs, sheets).
  static List<BoxShadow> get floating => const [
        BoxShadow(
          color: AppColors.shadowStrong,
          blurRadius: 24,
          offset: Offset(0, 8),
        ),
      ];
}
