import 'package:flutter/material.dart';

/// App color palette - Based on Patient App MVP Blueprint.
///
/// Design Psychology: Trust (Blue) + Healing (Teal) + Accessibility.
/// Manrope is the brand font (see app_theme.dart) to match the web portal.
class AppColors {
  // ---------------------------------------------------------------------------
  // Primary Colors — Medical Blue (Trust, Professional, Medical Industry Standard)
  // ---------------------------------------------------------------------------
  static const Color primary = Color(0xFF2563EB); // Blue-600
  static const Color primaryLight = Color(0xFF3B82F6); // Blue-500
  static const Color primaryDark = Color(0xFF1E40AF); // Blue-700
  static const Color primaryContainer = Color(0xFFDBEAFE); // Blue-100
  static const Color primaryOnContainer = Color(0xFF1E3A8A); // Blue-900

  // ---------------------------------------------------------------------------
  // Secondary Colors — Healing Teal (Calm, Growth, Reduces Anxiety)
  // ---------------------------------------------------------------------------
  static const Color secondary = Color(0xFF14B8A6); // Teal-500
  static const Color secondaryLight = Color(0xFF2DD4BF); // Teal-400
  static const Color secondaryDark = Color(0xFF0F766E); // Teal-700
  static const Color secondaryContainer = Color(0xFFCCFBF1); // Teal-100

  // ---------------------------------------------------------------------------
  // Semantic Status Colors — each with container / light / dark variants
  // ---------------------------------------------------------------------------

  // Success (Green)
  static const Color success = Color(0xFF10B981); // Green-500
  static const Color successLight = Color(0xFF34D399); // Green-400
  static const Color successDark = Color(0xFF047857); // Green-700
  static const Color successContainer = Color(0xFFD1FAE5); // Green-100

  // Error (Red)
  static const Color error = Color(0xFFEF4444); // Red-500
  static const Color errorLight = Color(0xFFF87171); // Red-400
  static const Color errorDark = Color(0xFFB91C1C); // Red-700
  static const Color errorContainer = Color(0xFFFEE2E2); // Red-100

  // Warning (Amber)
  static const Color warning = Color(0xFFF59E0B); // Amber-500
  static const Color warningLight = Color(0xFFFBBF24); // Amber-400
  static const Color warningDark = Color(0xFFD97706); // Amber-700
  static const Color warningContainer = Color(0xFFFEF3C7); // Amber-100

  // Info (Blue)
  static const Color info = Color(0xFF3B82F6); // Blue-500
  static const Color infoLight = Color(0xFF60A5FA); // Blue-400
  static const Color infoDark = Color(0xFF1D4ED8); // Blue-700
  static const Color infoContainer = Color(0xFFDBEAFE); // Blue-100

  // ---------------------------------------------------------------------------
  // Neutral Colors
  // ---------------------------------------------------------------------------
  static const Color white = Color(0xFFFFFFFF);
  static const Color black = Color(0xFF000000);

  static const Color gray50 = Color(0xFFF9FAFB);
  static const Color gray100 = Color(0xFFF3F4F6);
  static const Color gray200 = Color(0xFFE5E7EB);
  static const Color gray300 = Color(0xFFD1D5DB);
  static const Color gray400 = Color(0xFF9CA3AF);
  static const Color gray500 = Color(0xFF6B7280);
  static const Color gray600 = Color(0xFF4B5563);
  static const Color gray700 = Color(0xFF374151);
  static const Color gray800 = Color(0xFF1F2937);
  static const Color gray900 = Color(0xFF111827);

  // ---------------------------------------------------------------------------
  // Background & Surface
  // ---------------------------------------------------------------------------
  static const Color background = Color(0xFFF9FAFB); // gray-50
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceVariant = Color(0xFFF3F4F6); // gray-100
  static const Color surfaceDark = Color(0xFF1F2937); // gray-800

  // ---------------------------------------------------------------------------
  // Text Colors
  // ---------------------------------------------------------------------------
  static const Color textPrimary = Color(0xFF111827); // gray-900
  static const Color textSecondary = Color(0xFF6B7280); // gray-500
  static const Color textDisabled = Color(0xFF9CA3AF); // gray-400
  static const Color textOnPrimary = Color(0xFFFFFFFF);

  // ---------------------------------------------------------------------------
  // Border & Divider
  // ---------------------------------------------------------------------------
  static const Color border = Color(0xFFE5E7EB); // gray-200
  static const Color borderLight = Color(0xFFF3F4F6); // gray-100
  static const Color borderDark = Color(0xFFD1D5DB); // gray-300
  static const Color divider = Color(0xFFE5E7EB); // gray-200

  // ---------------------------------------------------------------------------
  // Shadow & Overlay
  // ---------------------------------------------------------------------------
  static const Color shadow = Color(0x1A000000); // black 10%
  static const Color shadowStrong = Color(0x33000000); // black 20%
  static const Color overlay = Color(0x80000000); // black 50%
  static const Color overlayLight = Color(0x40000000); // black 25%

  // ---------------------------------------------------------------------------
  // Specialty Colors (health features)
  // ---------------------------------------------------------------------------
  static const Color heartRate = Color(0xFFEF4444); // Red
  static const Color bloodPressure = Color(0xFF8B5CF6); // Purple
  static const Color temperature = Color(0xFFF59E0B); // Amber
  static const Color oxygen = Color(0xFF3B82F6); // Blue
  static const Color glucose = Color(0xFF10B981); // Green

  // ---------------------------------------------------------------------------
  // Emergency
  // ---------------------------------------------------------------------------
  static const Color emergency = Color(0xFFDC2626); // Red-600
  static const Color emergencyLight = Color(0xFFFEE2E2); // Red-50

  // ---------------------------------------------------------------------------
  // Gradients
  // ---------------------------------------------------------------------------
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

  static const LinearGradient emergencyGradient = LinearGradient(
    colors: [Color(0xFFDC2626), Color(0xFFEF4444)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient surfaceGradient = LinearGradient(
    colors: [white, gray50],
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
  );

  // ---------------------------------------------------------------------------
  // Chart Colors
  // ---------------------------------------------------------------------------
  static const List<Color> chartColors = [
    Color(0xFF3B82F6), // Blue
    Color(0xFF10B981), // Green
    Color(0xFFF59E0B), // Amber
    Color(0xFFEF4444), // Red
    Color(0xFF8B5CF6), // Purple
    Color(0xFF06B6D4), // Cyan
    Color(0xFFEC4899), // Pink
    Color(0xFF14B8A6), // Teal
  ];

  // ---------------------------------------------------------------------------
  // Dark Theme Colors
  // ---------------------------------------------------------------------------
  static const Color darkBackground = Color(0xFF0F172A); // Slate-900
  static const Color darkSurface = Color(0xFF1E293B); // Slate-800
  static const Color darkSurfaceVariant = Color(0xFF334155); // Slate-700
  static const Color darkBorder = Color(0xFF334155); // Slate-700
  static const Color darkTextPrimary = Color(0xFFF1F5F9); // Slate-100
  static const Color darkTextSecondary = Color(0xFF94A3B8); // Slate-400
}
