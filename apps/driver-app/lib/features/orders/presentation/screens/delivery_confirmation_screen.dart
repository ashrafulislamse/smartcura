import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Delivery confirmation screen.
///
/// Captures proof of delivery via photo (image_picker) or a simple
/// recipient-signature confirmation. The "Complete Delivery" button advances
/// the assignment to `completed` and navigates to the trip-complete screen.
/// If the backend rejects completion because proof is required, the error is
/// surfaced and the driver is prompted to capture proof first.
class DeliveryConfirmationScreen extends ConsumerStatefulWidget {
  final String orderId;

  const DeliveryConfirmationScreen({super.key, required this.orderId});

  @override
  ConsumerState<DeliveryConfirmationScreen> createState() =>
      _DeliveryConfirmationScreenState();
}

enum _ProofMethod { photo, signature }

class _DeliveryConfirmationScreenState
    extends ConsumerState<DeliveryConfirmationScreen> {
  String get _assignmentId => widget.orderId;

  _ProofMethod _method = _ProofMethod.photo;
  File? _photoFile;
  bool _signatureObtained = false;
  final _noteController = TextEditingController();
  final _imagePicker = ImagePicker();

  bool get _canConfirm =>
      _method == _ProofMethod.photo ? _photoFile != null : _signatureObtained;

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final assignment = ref.watch(dispatchAssignmentProvider(_assignmentId));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        title: const Text(
          'Delivery Confirmation',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
          ),
        ),
        centerTitle: false,
        titleSpacing: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: () => context.pop(),
        ),
      ),
      body: StateView<DispatchAssignmentSummary>(
        isLoading: assignment.isLoading,
        error: assignment.error,
        data: assignment.value,
        onRetry: () =>
            ref.invalidate(dispatchAssignmentProvider(_assignmentId)),
        builder: (data) => _body(context, data),
      ),
    );
  }

  Widget _body(BuildContext context, DispatchAssignmentSummary assignment) {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header banner
          Container(
            margin: const EdgeInsets.symmetric(
              horizontal: DesignTokens.screenPaddingHorizontal,
              vertical: DesignTokens.spaceSm,
            ),
            padding: const EdgeInsets.all(DesignTokens.spaceMd),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              border: Border.all(color: AppColors.gray200),
            ),
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: AppColors.successContainer,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  child: const Icon(Icons.home_rounded,
                      color: AppColors.success, size: 26),
                ),
                const SizedBox(width: DesignTokens.spaceMd),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'At Delivery Location',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Job ${_shortId(assignment.dispatchJobId)}',
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // Proof of delivery section
          PremiumCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Proof of Delivery',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceSm + 4),
                // Method selector
                Row(
                  children: [
                    _methodButton(
                      icon: Icons.camera_alt_rounded,
                      label: 'Photo',
                      selected: _method == _ProofMethod.photo,
                      onTap: () => setState(() => _method = _ProofMethod.photo),
                    ),
                    const SizedBox(width: 10),
                    _methodButton(
                      icon: Icons.draw_rounded,
                      label: 'Signature',
                      selected: _method == _ProofMethod.signature,
                      onTap: () =>
                          setState(() => _method = _ProofMethod.signature),
                    ),
                  ],
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                // Method-specific content
                if (_method == _ProofMethod.photo)
                  _photoSection()
                else
                  _signatureSection(),
              ],
            ),
          ),
          // Note section
          PremiumCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Delivery Note (Optional)',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                TextField(
                  controller: _noteController,
                  maxLines: 3,
                  decoration: InputDecoration(
                    hintText: 'e.g. Left with building guard\u2026',
                    filled: true,
                    fillColor: AppColors.gray50,
                    border: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                      borderSide: const BorderSide(color: AppColors.gray200),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                      borderSide: const BorderSide(color: AppColors.gray200),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                      borderSide:
                          BorderSide(color: AppColors.primary, width: 1.5),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          // Complete button
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.screenPaddingHorizontal),
            child: PrimaryButton(
              text: 'Complete Delivery',
              icon: Icons.check_circle_rounded,
              backgroundColor: AppColors.success,
              isLoading: ref.watch(advanceAssignmentNotifier).loading,
              onPressed: _canConfirm
                  ? () => _completeDelivery(assignment.version)
                  : null,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceXxl),
        ],
      ),
    );
  }

  // ---- Method button -------------------------------------------------------

  Widget _methodButton({
    required IconData icon,
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: DesignTokens.animDurationFast,
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primary.withValues(alpha: 0.08)
                : AppColors.gray50,
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.gray200,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Column(
            children: [
              Icon(icon,
                  color: selected ? AppColors.primary : AppColors.gray400,
                  size: 22),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: selected ? AppColors.primary : AppColors.textSecondary,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ---- Photo section -------------------------------------------------------

  Widget _photoSection() {
    return GestureDetector(
      onTap: _capturePhoto,
      child: Container(
        height: 160,
        width: double.infinity,
        decoration: BoxDecoration(
          color: _photoFile != null
              ? AppColors.success.withValues(alpha: 0.06)
              : AppColors.gray50,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          border: Border.all(
            color: _photoFile != null
                ? AppColors.success.withValues(alpha: 0.4)
                : AppColors.gray200,
          ),
          image: _photoFile != null
              ? DecorationImage(
                  image: FileImage(_photoFile!),
                  fit: BoxFit.cover,
                )
              : null,
        ),
        child: _photoFile != null
            ? null
            : Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: const [
                    Icon(Icons.camera_alt_rounded,
                        color: AppColors.gray400, size: 36),
                    SizedBox(height: 8),
                    Text('Tap to take photo',
                        style:
                            TextStyle(color: AppColors.gray400, fontSize: 13)),
                  ],
                ),
              ),
      ),
    );
  }

  Future<void> _capturePhoto() async {
    try {
      final photo = await _imagePicker.pickImage(
        source: ImageSource.camera,
        imageQuality: 80,
      );
      if (photo != null) {
        setState(() => _photoFile = File(photo.path));
      }
    } catch (_) {
      if (mounted) {
        AppSnackbar.error(context, 'Could not access camera');
      }
    }
  }

  // ---- Signature section ---------------------------------------------------

  Widget _signatureSection() {
    return GestureDetector(
      onTap: () => setState(() => _signatureObtained = true),
      child: Container(
        height: 160,
        width: double.infinity,
        decoration: BoxDecoration(
          color: _signatureObtained
              ? AppColors.success.withValues(alpha: 0.06)
              : AppColors.gray50,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          border: Border.all(
            color: _signatureObtained
                ? AppColors.success.withValues(alpha: 0.4)
                : AppColors.gray200,
          ),
        ),
        child: Center(
          child: _signatureObtained
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  children: const [
                    Icon(Icons.check_circle_rounded,
                        color: AppColors.success, size: 36),
                    SizedBox(height: 8),
                    Text('Signature Captured',
                        style: TextStyle(
                            color: AppColors.success,
                            fontWeight: FontWeight.w700,
                            fontSize: 14)),
                  ],
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: const [
                    Icon(Icons.draw_rounded,
                        color: AppColors.gray400, size: 36),
                    SizedBox(height: 8),
                    Text('Tap to capture signature',
                        style:
                            TextStyle(color: AppColors.gray400, fontSize: 13)),
                  ],
                ),
        ),
      ),
    );
  }

  // ---- State transitions ---------------------------------------------------

  Future<void> _completeDelivery(int expectedVersion) async {
    final notifier = ref.read(advanceAssignmentNotifier.notifier);
    final ok = await notifier.call(
      assignmentId: _assignmentId,
      status: 'completed',
      expectedVersion: expectedVersion,
    );
    if (!mounted) return;
    if (ok) {
      ref.invalidate(dispatchAssignmentProvider(_assignmentId));
      context.pushReplacement('/trip-complete?id=$_assignmentId');
    } else {
      final err = ref.read(advanceAssignmentNotifier).error;
      _handleError(err);
    }
  }

  void _handleError(ApiError? error) {
    if (error == null) {
      AppSnackbar.error(context, 'Something went wrong');
      return;
    }
    // Handle proof-required errors with a specific prompt.
    final msg = error.displayMessage.toLowerCase();
    if (msg.contains('proof')) {
      AppSnackbar.warning(
          context,
          'Proof of delivery is required before completing. '
          'Please capture a photo or signature.');
      return;
    }
    if (error.isConflict) {
      AppSnackbar.warning(context, 'Assignment was updated. Refreshing...');
      ref.invalidate(dispatchAssignmentProvider(_assignmentId));
    } else {
      AppSnackbar.error(context, error.displayMessage);
    }
  }

  // ---- Helpers -------------------------------------------------------------

  String _shortId(String id) =>
      id.length <= 12 ? id : '${id.substring(0, 8)}\u2026';
}
