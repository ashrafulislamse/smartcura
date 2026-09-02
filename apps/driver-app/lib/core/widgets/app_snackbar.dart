import 'package:flutter/material.dart';
import '../constants/app_colors.dart';

class AppSnackbar {
  AppSnackbar._();

  static void success(BuildContext context, String message) =>
      _show(context, message, AppColors.success, Icons.check_circle_rounded);

  static void error(BuildContext context, String message) =>
      _show(context, message, AppColors.emergency, Icons.error_rounded);

  static void info(BuildContext context, String message) =>
      _show(context, message, AppColors.info, Icons.info_rounded);

  static void warning(BuildContext context, String message) =>
      _show(context, message, AppColors.warning, Icons.warning_rounded);

  static void _show(BuildContext context, String message, Color color, IconData icon) {
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 3),
        behavior: SnackBarBehavior.floating,
        backgroundColor: Colors.transparent,
        elevation: 0,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        content: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(color: color.withOpacity(0.3), blurRadius: 12, offset: const Offset(0, 4)),
            ],
          ),
          child: Row(children: [
            Icon(icon, color: Colors.white, size: 20),
            const SizedBox(width: 10),
            Expanded(child: Text(message,
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14))),
          ]),
        ),
      ),
    );
  }
}
