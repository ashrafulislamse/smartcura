import 'package:flutter/material.dart';
import '../constants/app_colors.dart';

class ShimmerBox extends StatefulWidget {
  final double width;
  final double height;
  final double radius;
  const ShimmerBox({super.key, required this.width, required this.height, this.radius = 8});

  @override
  State<ShimmerBox> createState() => _ShimmerBoxState();
}

class _ShimmerBoxState extends State<ShimmerBox> with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _anim;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat();
    _anim = Tween<double>(begin: -1.5, end: 1.5).animate(
      CurvedAnimation(parent: _ctrl, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _anim,
      builder: (_, __) => Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(widget.radius),
          gradient: LinearGradient(
            begin: Alignment(_anim.value - 1, 0),
            end: Alignment(_anim.value + 1, 0),
            colors: const [
              Color(0xFFEEEEEE),
              Color(0xFFF5F5F5),
              Color(0xFFEEEEEE),
            ],
          ),
        ),
      ),
    );
  }
}

class ShimmerOrderCard extends StatelessWidget {
  const ShimmerOrderCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceLight,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            ShimmerBox(width: 40, height: 40, radius: 10),
            const SizedBox(width: 12),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ShimmerBox(width: 100, height: 13, radius: 6),
              const SizedBox(height: 6),
              ShimmerBox(width: 70, height: 11, radius: 6),
            ]),
            const Spacer(),
            ShimmerBox(width: 60, height: 24, radius: 8),
          ]),
          const SizedBox(height: 14),
          ShimmerBox(width: double.infinity, height: 11, radius: 6),
          const SizedBox(height: 6),
          ShimmerBox(width: 200, height: 11, radius: 6),
          const SizedBox(height: 14),
          Row(children: [
            ShimmerBox(width: 70, height: 28, radius: 8),
            const SizedBox(width: 8),
            ShimmerBox(width: 70, height: 28, radius: 8),
            const Spacer(),
            ShimmerBox(width: 80, height: 36, radius: 10),
          ]),
        ],
      ),
    );
  }
}

class ShimmerStatCard extends StatelessWidget {
  const ShimmerStatCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.backgroundLight,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.borderLight),
        ),
        child: Column(children: [
          ShimmerBox(width: 24, height: 24, radius: 12),
          const SizedBox(height: 8),
          ShimmerBox(width: 50, height: 16, radius: 6),
          const SizedBox(height: 4),
          ShimmerBox(width: 36, height: 10, radius: 5),
        ]),
      ),
    );
  }
}
