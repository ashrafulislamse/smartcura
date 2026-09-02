/// Design Tokens
/// 
/// Consistent spacing, sizing, and animation values
/// Following Material Design 3 guidelines
class DesignTokens {
  // Spacing (8px base unit)
  static const double spaceXs = 4.0;   // Extra small
  static const double spaceSm = 8.0;   // Small
  static const double spaceMd = 16.0;  // Medium (base)
  static const double spaceLg = 24.0;  // Large
  static const double spaceXl = 32.0;  // Extra large
  static const double space2xl = 48.0; // 2X large
  static const double space3xl = 64.0; // 3X large
  static const double space4xl = 80.0; // 4X large (hero spacing)
  
  // Border Radius
  static const double radiusXs = 4.0;   // Extra small
  static const double radiusSm = 8.0;   // Small
  static const double radiusMd = 12.0;  // Medium
  static const double radiusLg = 16.0;  // Large
  static const double radiusXl = 20.0;  // Extra large
  static const double radius2xl = 24.0; // 2X large
  static const double radius3xl = 32.0; // 3X large (hero cards)
  static const double radiusFull = 9999.0; // Fully rounded
  
  // Icon Sizes
  static const double iconXs = 16.0;   // Extra small
  static const double iconSm = 20.0;   // Small
  static const double iconMd = 24.0;   // Medium (default)
  static const double iconLg = 32.0;   // Large
  static const double iconXl = 40.0;   // Extra large
  static const double icon2xl = 48.0;  // 2X large
  static const double icon3xl = 64.0;  // 3X large
  
  // Button Heights
  static const double buttonHeightSm = 36.0;  // Small button
  static const double buttonHeightMd = 48.0;  // Medium button (default)
  static const double buttonHeightLg = 56.0;  // Large button
  
  // Input Heights
  static const double inputHeightSm = 40.0;  // Small input
  static const double inputHeightMd = 48.0;  // Medium input (default)
  static const double inputHeightLg = 56.0;  // Large input
  
  // Touch Targets (Accessibility)
  static const double touchTargetMin = 44.0;  // iOS minimum
  static const double touchTargetRecommended = 48.0; // Material Design
  
  // Bottom Navigation
  static const double bottomNavHeight = 56.0;
  static const double bottomNavIconSize = 24.0;
  
  // App Bar
  static const double appBarHeight = 56.0;
  static const double appBarElevation = 0.0; // Flat design
  
  // Card
  static const double cardElevation = 0.0; // Flat design
  static const double cardBorderWidth = 1.0;
  
  // Divider
  static const double dividerThickness = 1.0;
  static const double dividerIndent = 16.0;
  
  // Avatar Sizes
  static const double avatarXs = 24.0;   // Extra small
  static const double avatarSm = 32.0;   // Small
  static const double avatarMd = 40.0;   // Medium
  static const double avatarLg = 48.0;   // Large
  static const double avatarXl = 64.0;   // Extra large
  static const double avatar2xl = 80.0;  // 2X large
  static const double avatar3xl = 96.0;  // 3X large
  
  // Animation Durations (milliseconds)
  static const int animationFast = 150;     // Fast animations
  static const int animationNormal = 300;   // Normal animations
  static const int animationSlow = 500;     // Slow animations
  
  // Opacity
  static const double opacityDisabled = 0.38;  // Disabled elements
  static const double opacityMedium = 0.60;    // Medium emphasis
  static const double opacityHigh = 0.87;      // High emphasis
  
  // Elevation (Shadow)
  static const double elevation0 = 0.0;   // No shadow
  static const double elevation1 = 1.0;   // Subtle shadow
  static const double elevation2 = 2.0;   // Light shadow
  static const double elevation4 = 4.0;   // Medium shadow
  static const double elevation8 = 8.0;   // Strong shadow
  static const double elevation16 = 16.0; // Very strong shadow
  
  // Breakpoints (Responsive)
  static const double breakpointMobile = 480.0;   // Mobile devices
  static const double breakpointTablet = 768.0;   // Tablets
  static const double breakpointDesktop = 1024.0; // Desktop
  
  // Max Widths
  static const double maxWidthMobile = 480.0;
  static const double maxWidthTablet = 768.0;
  static const double maxWidthDesktop = 1200.0;
  
  // Line Heights (Typography)
  static const double lineHeightTight = 1.2;   // Tight line height
  static const double lineHeightNormal = 1.5;  // Normal line height
  static const double lineHeightRelaxed = 1.75; // Relaxed line height
  
  // Letter Spacing
  static const double letterSpacingTight = -0.5;
  static const double letterSpacingNormal = 0.0;
  static const double letterSpacingWide = 0.5;
  
  // Z-Index (Stacking)
  static const int zIndexBase = 0;
  static const int zIndexDropdown = 1000;
  static const int zIndexSticky = 1020;
  static const int zIndexFixed = 1030;
  static const int zIndexModalBackdrop = 1040;
  static const int zIndexModal = 1050;
  static const int zIndexPopover = 1060;
  static const int zIndexTooltip = 1070;
}
