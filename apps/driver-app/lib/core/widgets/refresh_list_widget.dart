import 'package:flutter/material.dart';

/// A [RefreshIndicator] wrapping a [ListView]. Pull-to-refresh is wired to the
/// [onRefresh] callback, which should invalidate the relevant providers.
/// When [items] is empty and an [emptyWidget] is supplied, the empty state is
/// shown while keeping pull-to-refresh active.
class RefreshListWidget<T> extends StatelessWidget {
  final List<T> items;
  final Widget Function(BuildContext, T, int) itemBuilder;
  final Future<void> Function() onRefresh;
  final Widget? emptyWidget;
  final EdgeInsets? padding;
  final ScrollController? controller;

  const RefreshListWidget({
    super.key,
    required this.items,
    required this.itemBuilder,
    required this.onRefresh,
    this.emptyWidget,
    this.padding,
    this.controller,
  });

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty && emptyWidget != null) {
      return RefreshIndicator(
        onRefresh: onRefresh,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: SizedBox(
            height: MediaQuery.of(context).size.height * 0.6,
            child: emptyWidget!,
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.separated(
        controller: controller,
        padding: padding,
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, index) =>
            itemBuilder(context, items[index], index),
      ),
    );
  }
}
