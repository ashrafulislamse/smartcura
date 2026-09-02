import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A search text field with a leading search icon and a trailing clear button.
class SearchBarWidget extends StatelessWidget {
  final String? hintText;
  final ValueChanged<String> onChanged;
  final TextEditingController? controller;
  final VoidCallback? onTap;

  const SearchBarWidget({
    super.key,
    this.hintText = 'Search…',
    required this.onChanged,
    this.controller,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      onTap: onTap,
      decoration: InputDecoration(
        hintText: hintText,
        prefixIcon: const Icon(Icons.search, color: AppColors.gray400),
        suffixIcon: ValueListenableBuilder<TextEditingValue>(
          valueListenable: controller ?? _EmptyController(),
          builder: (context, value, _) {
            if (value.text.isEmpty) return const SizedBox.shrink();
            return IconButton(
              icon: const Icon(Icons.close, color: AppColors.gray400, size: 18),
              onPressed: () {
                (controller ?? _EmptyController()).clear();
                onChanged('');
              },
            );
          },
        ),
        filled: true,
        fillColor: AppColors.gray50,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          borderSide: const BorderSide(color: AppColors.gray200),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          borderSide: const BorderSide(color: AppColors.primary, width: 2),
        ),
      ),
    );
  }
}

/// A no-op controller used when the caller does not supply one, so the clear
/// button logic still works.
class _EmptyController extends TextEditingController {
  _EmptyController() : super();
}
