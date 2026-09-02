import 'package:flutter/material.dart';

/// App Color Palette
/// 
/// Professional medical theme with Teal as primary color
/// Following Material Design 3 guidelines
class AppColors {
  // Primary Colors (Teal - Professional, Medical, Trustworthy)
  static const Color primary = Color(0xFF0F766E); // Teal-700
  static const Color primaryLight = Color(0xFF14B8A6); // Teal-500
  static const Color primaryDark = Color(0xFF115E59); // Teal-800
  static const Color primaryContainer = Color(0xFFCCFBF1); // Teal-100
  
  // Secondary Colors (Green - Success, Health, Positive)
  static const Color secondary = Color(0xFF10B981); // Green-500
  static const Color secondaryLight = Color(0xFF34D399); // Green-400
  static const Color secondaryDark = Color(0xFF059669); // Green-600
  static const Color secondaryContainer = Color(0xFFD1FAE5); // Green-100
  
  // Accent Colors (Blue - Actions, Links, Information)
  static const Color accent = Color(0xFF2563EB); // Blue-600
  static const Color accentLight = Color(0xFF3B82F6); // Blue-500
  static const Color accentDark = Color(0xFF1E40AF); // Blue-700
  static const Color accentContainer = Color(0xFFDBEAFE); // Blue-100
  
  // Status Colors
  static const Color error = Color(0xFFEF4444); // Red-500
  static const Color errorLight = Color(0xFFF87171); // Red-400
  static const Color errorDark = Color(0xFFDC2626); // Red-600
  static const Color errorContainer = Color(0xFFFEE2E2); // Red-100
  
  static const Color warning = Color(0xFFF59E0B); // Amber-500
  static const Color warningLight = Color(0xFFFBBF24); // Amber-400
  static const Color warningDark = Color(0xFFD97706); // Amber-600
  static const Color warningContainer = Color(0xFFFEF3C7); // Amber-100
  
  static const Color success = Color(0xFF10B981); // Green-500
  static const Color successLight = Color(0xFF34D399); // Green-400
  static const Color successDark = Color(0xFF059669); // Green-600
  static const Color successContainer = Color(0xFFD1FAE5); // Green-100
  
  static const Color info = Color(0xFF3B82F6); // Blue-500
  static const Color infoLight = Color(0xFF60A5FA); // Blue-400
  static const Color infoDark = Color(0xFF2563EB); // Blue-600
  static const Color infoContainer = Color(0xFFDBEAFE); // Blue-100
  
  // Neutral Colors (Grays)
  static const Color gray900 = Color(0xFF111827); // Primary text
  static const Color gray800 = Color(0xFF1F2937);
  static const Color gray700 = Color(0xFF374151); // Secondary text
  static const Color gray600 = Color(0xFF4B5563);
  static const Color gray500 = Color(0xFF6B7280); // Tertiary text
  static const Color gray400 = Color(0xFF9CA3AF); // Disabled text
  static const Color gray300 = Color(0xFFD1D5DB); // Borders
  static const Color gray200 = Color(0xFFE5E7EB); // Dividers
  static const Color gray100 = Color(0xFFF3F4F6); // Backgrounds
  static const Color gray50 = Color(0xFFF9FAFB); // Light backgrounds
  
  // Base Colors
  static const Color white = Color(0xFFFFFFFF);
  static const Color black = Color(0xFF000000);
  
  // Background Colors
  static const Color background = Color(0xFFF6F6F8); // Light gray background
  static const Color surface = Color(0xFFFFFFFF); // White surface (cards)
  static const Color surfaceVariant = Color(0xFFF9FAFB); // Light surface variant
  static const Color surfaceDim = Color(0xFFF3F4F6); // Dimmed surface (dark theme base inverse)
  static const Color surfaceBright = Color(0xFFFFFFFF); // Bright surface

  // Dark theme surface variants (Material 3 tonal palette, teal-tinted)
  static const Color darkBackground = Color(0xFF0B1220); // Deep slate
  static const Color darkSurface = Color(0xFF111827); // gray-900
  static const Color darkSurfaceVariant = Color(0xFF1F2937); // gray-800
  static const Color darkBorder = Color(0xFF374151); // gray-700
  static const Color darkDivider = Color(0xFF1F2937); // gray-800
  
  // Overlay Colors
  static const Color overlay = Color(0x80000000); // 50% black
  static const Color overlayLight = Color(0x40000000); // 25% black
  static const Color overlayDark = Color(0xB3000000); // 70% black
  
  // Shadow Colors
  static const Color shadow = Color(0x1A000000); // 10% black
  static const Color shadowLight = Color(0x0D000000); // 5% black
  static const Color shadowDark = Color(0x33000000); // 20% black
  static const Color shadowPrimary = Color(0x1A0F766E); // 10% teal (premium card lift)
  
  // Transparent
  static const Color transparent = Color(0x00000000);
  
  // Gradient Colors
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [primary, primaryLight],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
  
  static const LinearGradient secondaryGradient = LinearGradient(
    colors: [secondary, secondaryLight],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
  
  static const LinearGradient accentGradient = LinearGradient(
    colors: [accent, accentLight],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
  
  // Shimmer Colors (for loading states)
  static const Color shimmerBase = Color(0xFFE0E0E0);
  static const Color shimmerHighlight = Color(0xFFF5F5F5);
}
