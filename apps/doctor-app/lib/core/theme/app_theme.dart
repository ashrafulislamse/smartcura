import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'app_colors.dart';
import 'design_tokens.dart';

/// App Theme Configuration
/// 
/// Material Design 3 theme with custom colors and typography
class AppTheme {
  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      
      // Color Scheme
      colorScheme: const ColorScheme.light(
        primary: AppColors.primary,
        primaryContainer: AppColors.primaryContainer,
        secondary: AppColors.secondary,
        secondaryContainer: AppColors.secondaryContainer,
        tertiary: AppColors.accent,
        tertiaryContainer: AppColors.accentContainer,
        error: AppColors.error,
        errorContainer: AppColors.errorContainer,
        surface: AppColors.surface,
        surfaceContainerHighest: AppColors.gray100,
        onPrimary: AppColors.white,
        onSecondary: AppColors.white,
        onTertiary: AppColors.white,
        onError: AppColors.white,
        onSurface: AppColors.gray900,
        outline: AppColors.gray300,
        outlineVariant: AppColors.gray200,
      ),
      
      // Scaffold
      scaffoldBackgroundColor: AppColors.background,
      
      // App Bar
      appBarTheme: AppBarTheme(
        elevation: DesignTokens.appBarElevation,
        centerTitle: false,
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.gray900,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: GoogleFonts.inter(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: AppColors.gray900,
          letterSpacing: -0.5,
        ),
        iconTheme: const IconThemeData(
          color: AppColors.gray900,
          size: DesignTokens.iconMd,
        ),
      ),
      
      // Card
      cardTheme: CardThemeData(
        elevation: DesignTokens.cardElevation,
        color: AppColors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          side: const BorderSide(
            color: AppColors.gray200,
            width: DesignTokens.cardBorderWidth,
          ),
        ),
        margin: const EdgeInsets.all(0),
      ),
      
      // Elevated Button
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          elevation: 0,
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.white,
          disabledBackgroundColor: AppColors.gray300,
          disabledForegroundColor: AppColors.gray500,
          minimumSize: const Size(0, DesignTokens.buttonHeightMd),
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceLg,
            vertical: DesignTokens.spaceMd,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          ),
          textStyle: GoogleFonts.inter(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            letterSpacing: 0,
          ),
        ),
      ),
      
      // Outlined Button
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primary,
          disabledForegroundColor: AppColors.gray400,
          minimumSize: const Size(0, DesignTokens.buttonHeightMd),
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceLg,
            vertical: DesignTokens.spaceMd,
          ),
          side: const BorderSide(
            color: AppColors.primary,
            width: 1.5,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          ),
          textStyle: GoogleFonts.inter(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            letterSpacing: 0,
          ),
        ),
      ),
      
      // Text Button
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.primary,
          disabledForegroundColor: AppColors.gray400,
          minimumSize: const Size(0, DesignTokens.buttonHeightMd),
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd,
            vertical: DesignTokens.spaceSm,
          ),
          textStyle: GoogleFonts.inter(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            letterSpacing: 0,
          ),
        ),
      ),
      
      // Input Decoration
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.white,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceMd,
          vertical: DesignTokens.spaceMd,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(
            color: AppColors.gray300,
            width: 1,
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(
            color: AppColors.gray300,
            width: 1,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(
            color: AppColors.primary,
            width: 2,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(
            color: AppColors.error,
            width: 1,
          ),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(
            color: AppColors.error,
            width: 2,
          ),
        ),
        hintStyle: GoogleFonts.inter(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: AppColors.gray400,
        ),
        labelStyle: GoogleFonts.inter(
          fontSize: 14,
          fontWeight: FontWeight.w500,
          color: AppColors.gray700,
        ),
        errorStyle: GoogleFonts.inter(
          fontSize: 12,
          fontWeight: FontWeight.w400,
          color: AppColors.error,
        ),
      ),
      
      // Bottom Navigation Bar — premium: white surface, top hairline divider,
      // teal selected icon/label, generous vertical padding.
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppColors.white,
        selectedItemColor: AppColors.primary,
        unselectedItemColor: AppColors.gray400,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        showSelectedLabels: true,
        showUnselectedLabels: true,
        selectedLabelStyle: TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
        unselectedLabelStyle: TextStyle(fontSize: 11, fontWeight: FontWeight.w500),
      ),

      // NavigationBar (M3) — used by AppShell on newer Flutter. Teal indicator.
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.white,
        indicatorColor: AppColors.primaryContainer,
        indicatorShape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
            color: selected ? AppColors.primary : AppColors.gray500,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? AppColors.primary : AppColors.gray400,
            size: DesignTokens.bottomNavIconSize,
          );
        }),
        height: DesignTokens.bottomNavHeight + 8,
      ),
      
      // Divider
      dividerTheme: const DividerThemeData(
        color: AppColors.gray200,
        thickness: DesignTokens.dividerThickness,
        space: 0,
      ),
      
      // Icon
      iconTheme: const IconThemeData(
        color: AppColors.gray700,
        size: DesignTokens.iconMd,
      ),
      
      // Typography
      textTheme: GoogleFonts.interTextTheme().copyWith(
        // Display
        displayLarge: GoogleFonts.inter(
          fontSize: 57,
          fontWeight: FontWeight.w700,
          color: AppColors.gray900,
          letterSpacing: -1,
        ),
        displayMedium: GoogleFonts.inter(
          fontSize: 45,
          fontWeight: FontWeight.w700,
          color: AppColors.gray900,
          letterSpacing: -0.5,
        ),
        displaySmall: GoogleFonts.inter(
          fontSize: 36,
          fontWeight: FontWeight.w700,
          color: AppColors.gray900,
          letterSpacing: 0,
        ),
        
        // Headline
        headlineLarge: GoogleFonts.inter(
          fontSize: 32,
          fontWeight: FontWeight.w700,
          color: AppColors.gray900,
          letterSpacing: 0,
        ),
        headlineMedium: GoogleFonts.inter(
          fontSize: 28,
          fontWeight: FontWeight.w700,
          color: AppColors.gray900,
          letterSpacing: 0,
        ),
        headlineSmall: GoogleFonts.inter(
          fontSize: 24,
          fontWeight: FontWeight.w600,
          color: AppColors.gray900,
          letterSpacing: 0,
        ),
        
        // Title
        titleLarge: GoogleFonts.inter(
          fontSize: 22,
          fontWeight: FontWeight.w600,
          color: AppColors.gray900,
          letterSpacing: 0,
        ),
        titleMedium: GoogleFonts.inter(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: AppColors.gray900,
          letterSpacing: 0.15,
        ),
        titleSmall: GoogleFonts.inter(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppColors.gray900,
          letterSpacing: 0.1,
        ),
        
        // Body
        bodyLarge: GoogleFonts.inter(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: AppColors.gray700,
          letterSpacing: 0.5,
          height: 1.5,
        ),
        bodyMedium: GoogleFonts.inter(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          color: AppColors.gray700,
          letterSpacing: 0.25,
          height: 1.5,
        ),
        bodySmall: GoogleFonts.inter(
          fontSize: 12,
          fontWeight: FontWeight.w400,
          color: AppColors.gray500,
          letterSpacing: 0.4,
          height: 1.5,
        ),
        
        // Label
        labelLarge: GoogleFonts.inter(
          fontSize: 14,
          fontWeight: FontWeight.w500,
          color: AppColors.gray700,
          letterSpacing: 0.1,
        ),
        labelMedium: GoogleFonts.inter(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          color: AppColors.gray700,
          letterSpacing: 0.5,
        ),
        labelSmall: GoogleFonts.inter(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: AppColors.gray500,
          letterSpacing: 0.5,
        ),
      ),
    );
  }

  /// Dark theme: teal-tinted deep slate surfaces, inverted text, same brand
  /// accents. Card borders use gray-700 so they read against dark surfaces.
  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        primary: AppColors.primaryLight,
        primaryContainer: AppColors.primaryDark,
        secondary: AppColors.secondary,
        secondaryContainer: AppColors.secondaryDark,
        tertiary: AppColors.accentLight,
        tertiaryContainer: AppColors.accentDark,
        error: AppColors.errorLight,
        errorContainer: AppColors.errorDark,
        surface: AppColors.darkSurface,
        surfaceContainerHighest: AppColors.darkSurfaceVariant,
        onPrimary: AppColors.black,
        onSecondary: AppColors.black,
        onTertiary: AppColors.black,
        onError: AppColors.black,
        onSurface: AppColors.gray100,
        outline: AppColors.darkBorder,
        outlineVariant: AppColors.darkDivider,
      ),
      scaffoldBackgroundColor: AppColors.darkBackground,
      appBarTheme: AppBarTheme(
        elevation: DesignTokens.appBarElevation,
        centerTitle: false,
        backgroundColor: AppColors.darkSurface,
        foregroundColor: AppColors.gray100,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: GoogleFonts.inter(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: AppColors.gray100,
          letterSpacing: -0.5,
        ),
        iconTheme: const IconThemeData(
          color: AppColors.gray100,
          size: DesignTokens.iconMd,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: AppColors.darkSurface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          side: const BorderSide(color: AppColors.darkBorder, width: 1),
        ),
        margin: const EdgeInsets.all(0),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          elevation: 0,
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.white,
          minimumSize: const Size(0, DesignTokens.buttonHeightMd),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.darkSurfaceVariant,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(color: AppColors.darkBorder, width: 1),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(color: AppColors.darkBorder, width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(color: AppColors.primaryLight, width: 2),
        ),
        labelStyle: GoogleFonts.inter(
          fontSize: 14,
          fontWeight: FontWeight.w500,
          color: AppColors.gray300,
        ),
        hintStyle: GoogleFonts.inter(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: AppColors.gray500,
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.darkDivider,
        thickness: DesignTokens.dividerThickness,
        space: 0,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppColors.darkSurface,
        selectedItemColor: AppColors.primaryLight,
        unselectedItemColor: AppColors.gray500,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        showSelectedLabels: true,
        showUnselectedLabels: true,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.darkSurface,
        indicatorColor: AppColors.primaryDark,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
            color: selected ? AppColors.primaryLight : AppColors.gray500,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? AppColors.primaryLight : AppColors.gray500,
            size: DesignTokens.bottomNavIconSize,
          );
        }),
        height: DesignTokens.bottomNavHeight + 8,
      ),
      textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme).copyWith(
        displayLarge: GoogleFonts.inter(
            fontSize: 57, fontWeight: FontWeight.w700, color: AppColors.gray100),
        displayMedium: GoogleFonts.inter(
            fontSize: 45, fontWeight: FontWeight.w700, color: AppColors.gray100),
        displaySmall: GoogleFonts.inter(
            fontSize: 36, fontWeight: FontWeight.w700, color: AppColors.gray100),
        headlineLarge: GoogleFonts.inter(
            fontSize: 32, fontWeight: FontWeight.w700, color: AppColors.gray100),
        headlineMedium: GoogleFonts.inter(
            fontSize: 28, fontWeight: FontWeight.w700, color: AppColors.gray100),
        headlineSmall: GoogleFonts.inter(
            fontSize: 24, fontWeight: FontWeight.w600, color: AppColors.gray100),
        titleLarge: GoogleFonts.inter(
            fontSize: 22, fontWeight: FontWeight.w600, color: AppColors.gray100),
        titleMedium: GoogleFonts.inter(
            fontSize: 16, fontWeight: FontWeight.w600, color: AppColors.gray100),
        titleSmall: GoogleFonts.inter(
            fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.gray200),
        bodyLarge: GoogleFonts.inter(
            fontSize: 16, fontWeight: FontWeight.w400, color: AppColors.gray200),
        bodyMedium: GoogleFonts.inter(
            fontSize: 14, fontWeight: FontWeight.w400, color: AppColors.gray200),
        bodySmall: GoogleFonts.inter(
            fontSize: 12, fontWeight: FontWeight.w400, color: AppColors.gray400),
        labelLarge: GoogleFonts.inter(
            fontSize: 14, fontWeight: FontWeight.w500, color: AppColors.gray200),
        labelMedium: GoogleFonts.inter(
            fontSize: 12, fontWeight: FontWeight.w500, color: AppColors.gray300),
        labelSmall: GoogleFonts.inter(
            fontSize: 11, fontWeight: FontWeight.w500, color: AppColors.gray400),
      ),
    );
  }
}
