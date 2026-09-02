import 'package:flutter/material.dart';

class AnimatedCounter extends StatefulWidget {
  final double end;
  final String prefix;
  final String suffix;
  final TextStyle style;
  final Duration duration;
  final int decimals;

  const AnimatedCounter({
    super.key,
    required this.end,
    this.prefix = '',
    this.suffix = '',
    required this.style,
    this.duration = const Duration(milliseconds: 1200),
    this.decimals = 0,
  });

  @override
  State<AnimatedCounter> createState() => _AnimatedCounterState();
}

class _AnimatedCounterState extends State<AnimatedCounter>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _anim;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: widget.duration);
    _anim = Tween<double>(begin: 0, end: widget.end).animate(
      CurvedAnimation(parent: _ctrl, curve: Curves.easeOut),
    );
    _ctrl.forward();
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
      builder: (_, __) {
        final value = _anim.value;
        final text = widget.decimals > 0
            ? value.toStringAsFixed(widget.decimals)
            : value.toInt().toString();
        return Text('${widget.prefix}$text${widget.suffix}', style: widget.style);
      },
    );
  }
}

// Animated fade+slide in for list items
class FadeSlideIn extends StatefulWidget {
  final Widget child;
  final int index;
  final Duration baseDuration;

  const FadeSlideIn({
    super.key,
    required this.child,
    required this.index,
    this.baseDuration = const Duration(milliseconds: 300),
  });

  @override
  State<FadeSlideIn> createState() => _FadeSlideInState();
}

class _FadeSlideInState extends State<FadeSlideIn>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _fade;
  late Animation<Offset> _slide;

  @override
  void initState() {
    super.initState();
    final delay = Duration(milliseconds: widget.index * 80);
    _ctrl = AnimationController(vsync: this, duration: widget.baseDuration);
    _fade = CurvedAnimation(parent: _ctrl, curve: Curves.easeOut);
    _slide = Tween<Offset>(
      begin: const Offset(0, 0.12),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeOut));

    Future.delayed(delay, () {
      if (mounted) _ctrl.forward();
    });
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _fade,
      child: SlideTransition(position: _slide, child: widget.child),
    );
  }
}

// Pulse animation wrapper
class PulseWidget extends StatefulWidget {
  final Widget child;
  final Color color;
  const PulseWidget({super.key, required this.child, required this.color});

  @override
  State<PulseWidget> createState() => _PulseWidgetState();
}

class _PulseWidgetState extends State<PulseWidget>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(seconds: 1))
      ..repeat(reverse: true);
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (_, child) => Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: widget.color.withOpacity(0.4 * _ctrl.value),
              blurRadius: 16 * _ctrl.value,
              spreadRadius: 4 * _ctrl.value,
            ),
          ],
        ),
        child: child,
      ),
      child: widget.child,
    );
  }
}
