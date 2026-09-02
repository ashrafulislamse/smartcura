import 'dart:convert';

import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// An initials avatar with a deterministic gradient derived from the display
/// name. Falls back to a generic user icon when the name is empty.
///
/// Supports both network URLs and base64 `data:` URIs (the backend serves
/// avatars as `data:image/...;base64,...`). A broken or unparseable URI falls
/// back to the initials tile so the UI never renders a blank grey circle.
class AvatarWidget extends StatelessWidget {
  const AvatarWidget({
    super.key,
    required this.name,
    this.size = DesignTokens.avatarMd,
    this.imageUrl,
  });

  final String name;
  final double size;
  final String? imageUrl;

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts[1].substring(0, 1))
        .toUpperCase();
  }

  LinearGradient get _gradient {
    // Deterministic pick from the three brand gradients so the same name always
    // gets the same color — avoids flicker on rebuild.
    const palettes = [
      AppColors.primaryGradient,
      AppColors.secondaryGradient,
      AppColors.accentGradient,
    ];
    final hash = name.hashCode.abs();
    return palettes[hash % palettes.length];
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
        gradient: _gradient,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: _initials.isEmpty
          ? Icon(Icons.person_rounded, color: AppColors.white, size: size * 0.5)
          : Text(
              _initials,
              style: TextStyle(
                color: AppColors.white,
                fontSize: size * 0.38,
                fontWeight: FontWeight.w700,
              ),
            ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = _imageProvider(imageUrl);
    if (provider != null) {
      return SizedBox(
        width: size,
        height: size,
        child: ClipOval(
          child: Image(
            image: provider,
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
}
