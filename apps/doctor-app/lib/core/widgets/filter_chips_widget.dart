import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A single selectable chip option.
class FilterChipOption<T> {
  const FilterChipOption({required this.value, required this.label});
  final T value;
  final String label;
}

/// A horizontal wrap of selectable filter chips. At most one option is active at
/// a time (single-select). Pass `null` as the selected value to show none active.
class FilterChipsWidget<T> extends StatelessWidget {
  const FilterChipsWidget({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  final List<FilterChipOption<T>> options;
  final T? selected;
  final ValueChanged<T?> onSelected;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: DesignTokens.spaceSm,
      runSpacing: DesignTokens.spaceSm,
      children: [
        for (final option in options)
          FilterChip.build(context, option, selected == option.value, () {
            onSelected(selected == option.value ? null : option.value);
          }),
      ],
    );
  }
}

// Internal helper to keep the public widget a StatelessWidget with a clean API.
class FilterChip {
  static Widget build<T>(BuildContext context, FilterChipOption<T> option,
      bool isActive, VoidCallback onTap) {
    return Material(
      color: isActive ? AppColors.primary : AppColors.white,
      borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd,
            vertical: DesignTokens.spaceSm - 2,
          ),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            border: Border.all(
              color: isActive ? AppColors.primary : AppColors.gray300,
              width: 1,
            ),
          ),
          child: Text(
            option.label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: isActive ? AppColors.white : AppColors.gray700,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ),
      ),
    );
  }
}
