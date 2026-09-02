import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import 'emergency_assist_row.dart' show confirmAndOpenEmergency;

/// Opens the central "+" action sheet from anywhere (home header, bottom
/// nav center button).
///
/// Every row is a real route or a guarded flow; nothing here is a stub.
/// Navigation happens through the caller's context AFTER the sheet pops,
/// so the pushed route lands on the main stack rather than inside the
/// sheet's local navigator.
///
/// The "Sync health data" action routes to the Health Connect sync screen,
/// not a manual entry form, so the label matches what the screen actually
/// does.
Future<void> showCentralActionSheet(BuildContext context) {
  final rootContext = context;
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) => _ActionSheet(
      onAction: (action) {
        Navigator.of(sheetContext).pop();
        switch (action) {
          case _SheetAction.bookAppointment:
            rootContext.push('/find-doctor');
          case _SheetAction.addReading:
            rootContext.push('/health/enter-vitals');
          case _SheetAction.medications:
            rootContext.push('/prescriptions');
          case _SheetAction.pharmacy:
            rootContext.push('/pharmacy-orders');
          case _SheetAction.devices:
            rootContext.push('/iot/device-management');
          case _SheetAction.emergency:
            confirmAndOpenEmergency(rootContext);
        }
      },
    ),
  );
}

enum _SheetAction {
  bookAppointment,
  addReading,
  medications,
  pharmacy,
  devices,
  emergency,
}

class _SheetItem {
  final _SheetAction action;
  final IconData icon;
  final Color color;
  final String label;
  final String sublabel;

  const _SheetItem({
    required this.action,
    required this.icon,
    required this.color,
    required this.label,
    required this.sublabel,
  });
}

class _ActionSheet extends StatelessWidget {
  final ValueChanged<_SheetAction> onAction;

  const _ActionSheet({required this.onAction});

  static const _items = <_SheetItem>[
    _SheetItem(
      action: _SheetAction.bookAppointment,
      icon: Icons.calendar_month_rounded,
      color: AppColors.primary,
      label: 'Book appointment',
      sublabel: 'Find a doctor and reserve a slot',
    ),
    _SheetItem(
      action: _SheetAction.addReading,
      icon: Icons.watch_rounded,
      color: AppColors.success,
      label: 'Sync health data',
      sublabel: 'Pull vitals from Health Connect',
    ),
    _SheetItem(
      action: _SheetAction.medications,
      icon: Icons.medication_rounded,
      color: AppColors.warning,
      label: 'Medications',
      sublabel: 'View your prescriptions',
    ),
    _SheetItem(
      action: _SheetAction.pharmacy,
      icon: Icons.local_pharmacy_rounded,
      color: AppColors.bloodPressure,
      label: 'Pharmacy',
      sublabel: 'Track pharmacy orders',
    ),
    _SheetItem(
      action: _SheetAction.devices,
      icon: Icons.devices_other_rounded,
      color: AppColors.secondary,
      label: 'My devices',
      sublabel: 'Manage connected health devices',
    ),
    _SheetItem(
      action: _SheetAction.emergency,
      icon: Icons.emergency_rounded,
      color: AppColors.emergency,
      label: 'Emergency help',
      sublabel: 'Alert emergency services',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Container(
      margin: EdgeInsets.only(bottom: bottomInset),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(DesignTokens.radiusXl + 4),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            DesignTokens.spaceMd,
            DesignTokens.spaceSm,
            DesignTokens.spaceMd,
            DesignTokens.spaceMd,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.gray300,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: DesignTokens.spaceXs),
                child: Text(
                  'What would you like to do?',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    letterSpacing: -0.3,
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              ..._items.map(_buildRow),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRow(_SheetItem item) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceXs),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.lightImpact();
            onAction(item.action);
          },
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceSm,
              vertical: DesignTokens.spaceSm + 2,
            ),
            decoration: BoxDecoration(
              color: AppColors.gray50,
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: item.color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  child: Icon(item.icon, color: item.color, size: 20),
                ),
                const SizedBox(width: DesignTokens.spaceMd),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        item.label,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        item.sublabel,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.textSecondary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: AppColors.gray400,
                  size: 20,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
