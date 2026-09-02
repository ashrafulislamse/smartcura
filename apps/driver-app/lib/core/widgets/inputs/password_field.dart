import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'custom_text_field.dart';

/// Password Field Widget
/// Specialized text field for password input with visibility toggle.
/// WCAG 2.1 AA compliant with semantic labels and haptic feedback.
///
/// The default label is hardcoded to 'Password' because the driver app does
/// not yet ship an `AppStrings` constants file.
class PasswordField extends StatefulWidget {
  final String? label;
  final String? hint;
  final TextEditingController? controller;
  final String? Function(String?)? validator;

  const PasswordField({
    super.key,
    this.label,
    this.hint,
    this.controller,
    this.validator,
  });

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _obscureText = true;

  @override
  Widget build(BuildContext context) {
    return CustomTextField(
      label: widget.label ?? 'Password',
      hint: widget.hint,
      controller: widget.controller,
      obscureText: _obscureText,
      prefixIcon: Icons.lock_outlined,
      suffixIcon: Semantics(
        button: true,
        label: _obscureText ? 'Show password' : 'Hide password',
        child: MouseRegion(
          cursor: SystemMouseCursors.click,
          child: IconButton(
            icon: Icon(
              _obscureText
                  ? Icons.visibility_outlined
                  : Icons.visibility_off_outlined,
            ),
            onPressed: () {
              HapticFeedback.lightImpact();
              setState(() {
                _obscureText = !_obscureText;
              });
            },
          ),
        ),
      ),
      validator: widget.validator,
    );
  }
}
