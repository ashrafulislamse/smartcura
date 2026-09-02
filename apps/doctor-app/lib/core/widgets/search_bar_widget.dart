import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A search field with a leading search icon and a clear button that appears
/// once text is entered. Delegates filtering to the caller via [onChanged].
class SearchBarWidget extends StatelessWidget {
  const SearchBarWidget({
    super.key,
    required this.onChanged,
    this.hint = 'Search',
    this.controller,
    this.onSubmitted,
  });

  final ValueChanged<String> onChanged;
  final String hint;
  final TextEditingController? controller;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: hint,
        prefixIcon: const Icon(Icons.search_rounded,
            color: AppColors.gray400, size: DesignTokens.iconSm),
        suffixIcon: ValueListenableBuilder<TextEditingValue>(
          valueListenable: controller ?? _emptyController,
          builder: (context, value, _) {
            if (value.text.isEmpty) return const SizedBox.shrink();
            return IconButton(
              icon: const Icon(Icons.close_rounded,
                  size: DesignTokens.iconSm, color: AppColors.gray400),
              onPressed: () {
                (controller ?? _emptyController).clear();
                onChanged('');
              },
              splashRadius: 16,
            );
          },
        ),
        isDense: true,
      ),
    );
  }
}

// Used only when no external controller is supplied, so the clear button logic
// can still observe emptiness.
final _emptyController = TextEditingController();
