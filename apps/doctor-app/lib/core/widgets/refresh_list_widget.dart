import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import 'empty_view.dart';

/// A [RefreshIndicator] wrapping a [ListView.builder]. Shows an [EmptyView]
/// when the item count is zero, otherwise builds each item via [itemBuilder].
///
/// Use this for any paginated list screen so pull-to-refresh is consistent.
class RefreshListWidget<T> extends StatelessWidget {
  const RefreshListWidget({
    super.key,
    required this.items,
    required this.itemBuilder,
    required this.onRefresh,
    this.emptyTitle = 'Nothing here yet',
    this.emptyBody,
    this.emptyIcon,
    this.padding,
    this.separator,
  });

  final List<T> items;
  final Widget Function(BuildContext, T, int) itemBuilder;
  final Future<void> Function() onRefresh;
  final String emptyTitle;
  final String? emptyBody;
  final IconData? emptyIcon;
  final EdgeInsets? padding;
  final Widget? separator;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return RefreshIndicator(
        color: AppColors.primary,
        onRefresh: onRefresh,
        child: ListView(
          // Keep it scrollable so the indicator still works when empty.
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(
              height: MediaQuery.of(context).size.height * 0.6,
              child: EmptyView(
                title: emptyTitle,
                body: emptyBody,
                icon: emptyIcon ?? Icons.list_alt_rounded,
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: onRefresh,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: padding,
        itemCount: items.length,
        separatorBuilder: (_, __) =>
            separator ?? const SizedBox(height: 0),
        itemBuilder: (context, index) =>
            itemBuilder(context, items[index], index),
      ),
    );
  }
}
