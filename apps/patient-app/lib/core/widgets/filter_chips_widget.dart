import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A horizontally-scrolling row of selectable filter chips. The active chips
/// are styled with the primary colour; inactive ones use the neutral surface.
class FilterChipsWidget<T> extends StatelessWidget {
  final List<T> options;
  final T? selected;
  final ValueChanged<T?> onSelected;
  final String Function(T) labelBuilder;
  final bool multiSelect;
  final List<T> selectedValues;

  const FilterChipsWidget({
    super.key,
    required this.options,
    this.selected,
    required this.onSelected,
    required this.labelBuilder,
    this.multiSelect = false,
    this.selectedValues = const [],
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
        itemCount: options.length,
        separatorBuilder: (_, __) => const SizedBox(width: DesignTokens.spaceSm),
        itemBuilder: (context, index) {
          final option = options[index];
          final isActive = multiSelect
              ? selectedValues.contains(option)
              : option == selected;
          return FilterChip(
            label: Text(labelBuilder(option)),
            selected: isActive,
            onSelected: (value) {
              if (multiSelect) {
                final newValues = List<T>.from(selectedValues);
                if (value) {
                  newValues.add(option);
                } else {
                  newValues.remove(option);
                }
                // Caller handles multi-select via a separate callback path.
                onSelected(value ? option : null);
              } else {
                onSelected(value ? option : null);
              }
            },
            selectedColor: AppColors.primary,
            labelStyle: TextStyle(
              color: isActive ? AppColors.white : AppColors.textSecondary,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
            backgroundColor: AppColors.gray100,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
              side: BorderSide(
                color: isActive ? AppColors.primary : AppColors.gray200,
              ),
            ),
            showCheckmark: false,
            padding: const EdgeInsets.symmetric(horizontal: 4),
          );
        },
      ),
    );
  }
}
