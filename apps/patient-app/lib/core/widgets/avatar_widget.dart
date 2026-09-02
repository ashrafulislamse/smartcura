import 'dart:convert';

import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// A circular avatar that shows a network image when available.
///
/// Falls back to initials over a gradient background in three cases: no image
/// URL (the common case for doctors in the directory, where `image_url` is
/// nullable), while the image is still loading, and when the image request
/// fails (e.g. a missing storage object) — so a broken URL can never render
/// a blank grey circle.
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
    final imageProvider = _imageProvider(imageUrl);
    if (imageProvider != null) {
      return SizedBox(
        width: size,
        height: size,
        child: ClipOval(
          child: Image(
            image: imageProvider,
            fit: BoxFit.cover,
            frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
              // Show the initials tile until the first frame has decoded.
              if (wasSynchronouslyLoaded || frame != null) return child;
              return _initialsTile();
            },
            errorBuilder: (context, error, stackTrace) => _initialsTile(),
          ),
        ),
      );
    }

    return _initialsTile();
  }

  ImageProvider? _imageProvider(String? url) {
    if (url == null || url.isEmpty) return null;
    if (url.startsWith('data:')) {
      final commaIndex = url.indexOf(',');
      if (commaIndex == -1) return null;
      final base64String = url.substring(commaIndex + 1);
      try {
        return MemoryImage(base64Decode(base64String));
      } catch (_) {
        return null;
      }
    }
    return NetworkImage(url);
  }

  Widget _initialsTile() {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: gradient ??
            const LinearGradient(
              colors: [AppColors.primary, AppColors.primaryLight],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
      ),
      alignment: Alignment.center,
      child: Text(
        _initials(name),
        style: TextStyle(
          color: AppColors.white,
          fontSize: size * 0.38,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0].substring(0, 1).toUpperCase();
    return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
  }
}
