/// Design tokens for consistent UI.
///
/// All durations, z-indices, line heights, letter spacing, and elevation
/// values are declared here so a widget never invents a magic number.
class DesignTokens {
  DesignTokens._();

  // ---------------------------------------------------------------------------
  // Spacing (8px base unit)
  // ---------------------------------------------------------------------------
  static const double spaceXs = 4.0;
  static const double spaceSm = 8.0;
  static const double spaceMd = 16.0;
  static const double spaceLg = 24.0;
  static const double spaceXl = 32.0;
  static const double space2xl = 48.0;
  static const double space3xl = 64.0;

  // ---------------------------------------------------------------------------
  // Border Radius
  // ---------------------------------------------------------------------------
  static const double radiusXs = 4.0;
  static const double radiusSm = 8.0;
  static const double radiusMd = 12.0;
  static const double radiusLg = 16.0;
  static const double radiusXl = 20.0;
  static const double radius2xl = 24.0;
  static const double radiusFull = 9999.0; // Pill shape

  // ---------------------------------------------------------------------------
  // Elevation Scale (Shadow)
  // ---------------------------------------------------------------------------
  static const double elevationNone = 0.0;
  static const double elevationSm = 2.0;
  static const double elevationMd = 4.0;
  static const double elevationLg = 8.0;
  static const double elevationXl = 12.0;
  static const double elevation2xl = 16.0;

  /// BoxShadow presets for premium cards.
  static const List<BoxShadowPreset> cardShadows = [
    BoxShadowPreset(blurRadius: 8, offset: 2, opacity: 0.10),
  ];

  // ---------------------------------------------------------------------------
  // Icon Sizes
  // ---------------------------------------------------------------------------
  static const double iconXs = 16.0;
  static const double iconSm = 20.0;
  static const double iconMd = 24.0;
  static const double iconLg = 32.0;
  static const double iconXl = 48.0;
  static const double icon2xl = 64.0;

  // ---------------------------------------------------------------------------
  // Touch Targets (Minimum 48x48px for accessibility)
  // ---------------------------------------------------------------------------
  static const double touchTargetMin = 48.0;
  static const double touchTargetMd = 56.0;
  static const double touchTargetLg = 64.0;

  // ---------------------------------------------------------------------------
  // Button Heights
  // ---------------------------------------------------------------------------
  static const double buttonHeightSm = 40.0;
  static const double buttonHeightMd = 48.0;
  static const double buttonHeightLg = 56.0;

  // ---------------------------------------------------------------------------
  // Input Heights
  // ---------------------------------------------------------------------------
  static const double inputHeightSm = 48.0;
  static const double inputHeightMd = 56.0;
  static const double inputHeightLg = 64.0;

  // ---------------------------------------------------------------------------
  // Bottom Navigation
  // ---------------------------------------------------------------------------
  static const double bottomNavHeight = 56.0;
  static const double bottomNavHeightWithSafeArea = 90.0; // 56 + 34 (iPhone notch)

  // ---------------------------------------------------------------------------
  // App Bar
  // ---------------------------------------------------------------------------
  static const double appBarHeight = 56.0;
  static const double appBarHeightLarge = 64.0;

  // ---------------------------------------------------------------------------
  // Card
  // ---------------------------------------------------------------------------
  static const double cardPadding = 16.0;
  static const double cardMargin = 8.0;

  // ---------------------------------------------------------------------------
  // Screen Padding
  // ---------------------------------------------------------------------------
  static const double screenPaddingHorizontal = 16.0;
  static const double screenPaddingVertical = 16.0;

  // ---------------------------------------------------------------------------
  // Animation Durations (int milliseconds for precise control)
  // ---------------------------------------------------------------------------
  static const int animFastMs = 150;
  static const int animNormalMs = 300;
  static const int animSlowMs = 500;
  static const int animPageMs = 250;

  static const Duration animationFast = Duration(milliseconds: animFastMs);
  static const Duration animationNormal = Duration(milliseconds: animNormalMs);
  static const Duration animationSlow = Duration(milliseconds: animSlowMs);

  // ---------------------------------------------------------------------------
  // Transition Durations
  // ---------------------------------------------------------------------------
  static const Duration transitionFast = Duration(milliseconds: 200);
  static const Duration transitionNormal = Duration(milliseconds: 250);
  static const Duration transitionSlow = Duration(milliseconds: 350);

  // ---------------------------------------------------------------------------
  // Z-Index (for stacking overlays, sheets, dialogs)
  // ---------------------------------------------------------------------------
  static const int zIndexBase = 0;
  static const int zIndexContent = 1;
  static const int zIndexSticky = 10;
  static const int zIndexDropdown = 100;
  static const int zIndexDrawer = 200;
  static const int zIndexModal = 300;
  static const int zIndexSnackbar = 400;
  static const int zIndexTooltip = 500;
  static const int zIndexOverlay = 600;

  // ---------------------------------------------------------------------------
  // Line Heights (multiplier on font size)
  // ---------------------------------------------------------------------------
  static const double lineHeightTight = 1.2;
  static const double lineHeightNormal = 1.4;
  static const double lineHeightRelaxed = 1.6;

  // ---------------------------------------------------------------------------
  // Letter Spacing
  // ---------------------------------------------------------------------------
  static const double letterSpacingTight = -0.5;
  static const double letterSpacingNormal = 0.0;
  static const double letterSpacingWide = 0.5;
  static const double letterSpacingWider = 1.0;

  // ---------------------------------------------------------------------------
  // Opacity
  // ---------------------------------------------------------------------------
  static const double opacityDisabled = 0.5;
  static const double opacityHover = 0.8;
  static const double opacityPressed = 0.6;

  // ---------------------------------------------------------------------------
  // Border Width
  // ---------------------------------------------------------------------------
  static const double borderWidthThin = 1.0;
  static const double borderWidthMedium = 1.5;
  static const double borderWidthThick = 2.0;

  // ---------------------------------------------------------------------------
  // Divider
  // ---------------------------------------------------------------------------
  static const double dividerThickness = 1.0;
  static const double dividerIndent = 16.0;

  // ---------------------------------------------------------------------------
  // Avatar Sizes
  // ---------------------------------------------------------------------------
  static const double avatarSm = 32.0;
  static const double avatarMd = 48.0;
  static const double avatarLg = 64.0;
  static const double avatarXl = 96.0;
  static const double avatar2xl = 128.0;

  // ---------------------------------------------------------------------------
  // Badge
  // ---------------------------------------------------------------------------
  static const double badgeSizeSm = 16.0;
  static const double badgeSizeMd = 20.0;
  static const double badgeSizeLg = 24.0;

  // ---------------------------------------------------------------------------
  // Max Widths (for responsive design)
  // ---------------------------------------------------------------------------
  static const double maxWidthMobile = 480.0;
  static const double maxWidthTablet = 768.0;
  static const double maxWidthDesktop = 1024.0;

  // ---------------------------------------------------------------------------
  // Breakpoints
  // ---------------------------------------------------------------------------
  static const double breakpointMobile = 480.0;
  static const double breakpointTablet = 768.0;
  static const double breakpointDesktop = 1024.0;
}

/// A preset for box shadows used by premium cards.
class BoxShadowPreset {
  final double blurRadius;
  final double offset;
  final double opacity;
  const BoxShadowPreset({
    required this.blurRadius,
    required this.offset,
    required this.opacity,
  });
}
