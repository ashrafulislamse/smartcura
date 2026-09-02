import 'package:flutter/material.dart';

class AppColors {
  AppColors._();

  static const Color primary = Color(0xFF1E3FAE);
  static const Color primaryDark = Color(0xFF152D7E);
  static const Color primaryLight = Color(0xFF3D5CC4);

  static const Color accent = Color(0xFF00B894);
  static const Color accentDark = Color(0xFF00997C);

  static const Color emergency = Color(0xFFE53E3E);
  static const Color warning = Color(0xFFF6A623);
  static const Color success = Color(0xFF00B894);
  static const Color info = Color(0xFF3182CE);

  static const Color backgroundLight = Color(0xFFF8FAFC);
  static const Color backgroundDark = Color(0xFF0F1117);
  static const Color surfaceLight = Color(0xFFFFFFFF);
  static const Color surfaceDark = Color(0xFF1A1E2E);
  static const Color cardDark = Color(0xFF1E2336);

  static const Color textPrimary = Color(0xFF1A202C);
  static const Color textSecondary = Color(0xFF718096);
  static const Color textLight = Color(0xFFFFFFFF);
  static const Color textMuted = Color(0xFFA0AEC0);

  static const Color borderLight = Color(0xFFE2E8F0);
  static const Color borderDark = Color(0xFF2D3748);

  static const Color statusNew = Color(0xFF3182CE);
  static const Color statusInTransit = Color(0xFFF6A623);
  static const Color statusDelivered = Color(0xFF00B894);
  static const Color statusCancelled = Color(0xFFE53E3E);

  static const LinearGradient primaryGradient = LinearGradient(
    colors: [primary, primaryLight],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient emergencyGradient = LinearGradient(
    colors: [Color(0xFFE53E3E), Color(0xFFC53030)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
