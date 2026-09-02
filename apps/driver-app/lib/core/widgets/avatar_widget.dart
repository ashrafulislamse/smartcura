import 'dart:convert';

import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// A circular avatar that shows initials over a gradient background. Falls back
/// gracefully when no image URL is available (the common case for drivers and
/// recipients in the directory, where `image_url` is nullable).
class AvatarWidget extends StatelessWidget {
  final String? imageUrl;
  final String name;
  final double size;
  final LinearGradient? gradient;

  const AvatarWidget({
    super.key,
    this.imageUrl,
    required this.name,
    this.size = 48,
    this.gradient,
  });

  @override
  Widget build(BuildContext context) {
    final initials = _initials(name);
    final defaultGradient = gradient ??
        const LinearGradient(
          colors: [AppColors.primary, AppColors.primaryLight],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        );

    if (imageUrl != null && imageUrl!.isNotEmpty) {
      final imageProvider = _imageProvider(imageUrl!);
      return CircleAvatar(
        radius: size / 2,
        backgroundImage: imageProvider,
        backgroundColor: AppColors.gray100,
      );
    }

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: defaultGradient,
      ),
      alignment: Alignment.center,
      child: Text(
        initials,
        style: TextStyle(
          color: AppColors.white,
          fontSize: size * 0.38,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  ImageProvider _imageProvider(String url) {
    if (url.startsWith('data:')) {
      final commaIndex = url.indexOf(',');
      if (commaIndex != -1) {
        try {
          final bytes = base64Decode(url.substring(commaIndex + 1));
          return MemoryImage(bytes);
        } catch (_) {
          // Fall back to initials if the data URI is malformed.
        }
      }
    }
    return NetworkImage(url);
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0].substring(0, 1).toUpperCase();
    return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
  }
}
