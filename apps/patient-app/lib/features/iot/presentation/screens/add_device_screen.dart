import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:network_info_plus/network_info_plus.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../data/pending_provisioning_device_store.dart';
import '../providers/ble_provisioning_provider.dart';
import '../providers/iot_device_management_provider.dart';

/// Add Device — patient-side BLE provisioning for a SmartCura ESP32.
///
/// Flow:
/// 1. Scan the QR sticker on the device (or enter the device ID manually).
/// 2. The app scans BLE for a peripheral advertising as SmartCura-XXXX.
/// 3. The app reads the device ID characteristic and verifies it matches.
/// 4. The patient enters the 8-digit provisioning PIN from the sticker.
/// 5. The patient enters the Wi-Fi network name and password.
/// 6. Credentials are sent over encrypted BLE; the ESP32 saves them and reboots.
/// 7. The app automatically assigns the device to the patient's profile via
///    POST /profiles/me/devices/{id}/assignments so it is ready to sync vitals
///    without waiting for a care-provider approval step.
class AddDeviceScreen extends ConsumerWidget {
  const AddDeviceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(bleProvisioningProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.textPrimary),
          onPressed: () {
            if (state.phase != ProvisioningPhase.initial &&
                state.phase != ProvisioningPhase.success) {
              ref.read(bleProvisioningProvider.notifier).reset();
            }
            context.pop();
          },
        ),
        title: Text(
          'Add Device',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
        ),
      ),
      body: SafeArea(
        child: _buildBody(context, ref, state),
      ),
    );
  }

  Widget _buildBody(
          BuildContext context, WidgetRef ref, BleProvisioningState state) =>
      switch (state.phase) {
        ProvisioningPhase.initial => _IntroStep(
            onStart: () =>
                ref.read(bleProvisioningProvider.notifier).startProvisioning(),
          ),
        ProvisioningPhase.enteringDeviceId => _DeviceIdStep(
            onQrScanned: (id) => ref
                .read(bleProvisioningProvider.notifier)
                .setTargetDeviceId(id),
          ),
        ProvisioningPhase.scanning => _ScanningStep(state: state),
        ProvisioningPhase.connecting => _ConnectingStep(state: state),
        ProvisioningPhase.verifyingDeviceId =>
          _VerifyingDeviceIdStep(state: state),
        ProvisioningPhase.enteringPin => _PinStep(
            state: state,
            onVerify: (pin) =>
                ref.read(bleProvisioningProvider.notifier).verifyPin(pin),
          ),
        ProvisioningPhase.verifyingPin => _PinStep(
            state: state,
            onVerify: (_) {},
          ),
        ProvisioningPhase.enteringWifi => _WifiStep(
            onSend: (ssid, password) => ref
                .read(bleProvisioningProvider.notifier)
                .sendWifiCredentials(ssid, password),
          ),
        ProvisioningPhase.sendingCredentials ||
        ProvisioningPhase.provisioning =>
          _ProvisioningStep(state: state),
        ProvisioningPhase.success => _SuccessStep(
            targetDeviceId: state.targetDeviceId,
            onDone: () => context.pop(),
          ),
        ProvisioningPhase.error => _ErrorStep(
            state: state,
            onRetry: () => ref.read(bleProvisioningProvider.notifier).reset(),
          ),
      };
}

class _IntroStep extends StatelessWidget {
  const _IntroStep({required this.onStart});
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(DesignTokens.spaceLg),
              decoration: BoxDecoration(
                color: AppColors.primaryContainer.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              ),
              child: Column(
                children: [
                  Container(
                    width: 72,
                    height: 72,
                    decoration: const BoxDecoration(
                      color: AppColors.primaryContainer,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.monitor_heart,
                      color: AppColors.primary,
                      size: 36,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  Text(
                    'Connect a SmartCura Vitals Monitor',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: DesignTokens.spaceSm),
                  Text(
                    'Scan the QR code on your device, then enter your '
                    'Wi-Fi details. '
                    'The device will be automatically assigned to your '
                    'account and ready to sync vitals.',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.textSecondary,
                        ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            Text(
              'What happens next',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            const _StepItem(
              number: '1',
              title: 'Scan the QR sticker',
              body:
                  'Use your camera to read the device ID and provisioning PIN.',
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            const _StepItem(
              number: '2',
              title: 'Connect over Bluetooth',
              body: 'The app finds the SmartCura device '
                  'and verifies its identity.',
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            const _StepItem(
              number: '3',
              title: 'Send Wi-Fi credentials',
              body: 'The device saves your network details and restarts.',
            ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: onStart,
                icon: const Icon(Icons.qr_code_scanner),
                label: const Text('Scan Device QR'),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
          ],
        ),
      );
}

class _DeviceIdStep extends StatefulWidget {
  const _DeviceIdStep({required this.onQrScanned});
  final ValueChanged<String> onQrScanned;

  @override
  State<_DeviceIdStep> createState() => _DeviceIdStepState();
}

class _DeviceIdStepState extends State<_DeviceIdStep> {
  final _controller = TextEditingController();
  bool _useManual = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Device identification',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              'Scan the QR code on the SmartCura device sticker, '
              'or type the device ID manually.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.textSecondary,
                  ),
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            if (!_useManual) ...[
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                  child: MobileScanner(
                    onDetect: (capture) {
                      final barcodes = capture.barcodes;
                      for (final barcode in barcodes) {
                        final raw = barcode.rawValue?.trim();
                        if (raw != null && raw.isNotEmpty) {
                          widget.onQrScanned(raw);
                          return;
                        }
                      }
                    },
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
            ] else ...[
              TextField(
                controller: _controller,
                decoration: const InputDecoration(
                  labelText: 'Device ID',
                  hintText: '019ff4b0-4292-7a57-ac13-e2ee56c02272',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    final id = _controller.text.trim();
                    if (id.isNotEmpty) {
                      widget.onQrScanned(id);
                    }
                  },
                  child: const Text('Continue'),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
            ],
            SizedBox(
              width: double.infinity,
              child: TextButton(
                onPressed: () => setState(() => _useManual = !_useManual),
                child: Text(_useManual
                    ? 'Scan QR code instead'
                    : 'Enter device ID manually'),
              ),
            ),
          ],
        ),
      );
}

class _ScanningStep extends StatelessWidget {
  const _ScanningStep({required this.state});
  final BleProvisioningState state;

  @override
  Widget build(BuildContext context) {
    final targetId = state.targetDeviceId;
    final last4 = targetId?.substring(targetId.length - 4);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: DesignTokens.spaceLg),
            Text(
              'Looking for ${last4 ?? ''}...',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              'Make sure the device is powered on and in provisioning mode. '
              'Hold GPIO4 for 3 seconds if the screen shows "Setup mode".',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.textSecondary,
                  ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _ConnectingStep extends StatelessWidget {
  const _ConnectingStep({required this.state});
  final BleProvisioningState state;

  @override
  Widget build(BuildContext context) => Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: DesignTokens.spaceLg),
            Text(
              'Connecting to '
              '${state.selectedDevice?.name ?? 'SmartCura device'}...',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
}

class _VerifyingDeviceIdStep extends StatelessWidget {
  const _VerifyingDeviceIdStep({required this.state});
  final BleProvisioningState state;

  @override
  Widget build(BuildContext context) => Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: DesignTokens.spaceLg),
            Text(
              'Verifying device identity...',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              'Expected: ${state.targetDeviceId}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: AppColors.textSecondary,
                  ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
}

class _PinStep extends StatefulWidget {
  const _PinStep({required this.state, required this.onVerify});
  final BleProvisioningState state;
  final ValueChanged<String> onVerify;

  @override
  State<_PinStep> createState() => _PinStepState();
}

class _PinStepState extends State<_PinStep> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isVerifying = widget.state.phase == ProvisioningPhase.verifyingPin;

    return Padding(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Enter provisioning PIN',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            'Type the 8-digit PIN printed on the device sticker '
            'or shown in the QR code.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.textSecondary,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          TextField(
            controller: _controller,
            keyboardType: TextInputType.number,
            maxLength: 8,
            enabled: !isVerifying,
            obscureText: true,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(
              labelText: 'PIN',
              hintText: '00000000',
              border: OutlineInputBorder(),
              counterText: '',
            ),
          ),
          if (widget.state.errorMessage != null) ...[
            const SizedBox(height: DesignTokens.spaceMd),
            Text(
              widget.state.errorMessage!,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.error,
                  ),
            ),
          ],
          const Spacer(),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: isVerifying
                  ? null
                  : () {
                      final pin = _controller.text.trim();
                      if (pin.length == 8) {
                        widget.onVerify(pin);
                      }
                    },
              child: isVerifying
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Verify PIN'),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
        ],
      ),
    );
  }
}

class _WifiStep extends StatefulWidget {
  const _WifiStep({required this.onSend});
  final void Function(String ssid, String password) onSend;

  @override
  State<_WifiStep> createState() => _WifiStepState();
}

class _WifiStepState extends State<_WifiStep> {
  final _ssidController = TextEditingController();
  final _passwordController = TextEditingController();
  final _networkInfo = NetworkInfo();
  bool _obscurePassword = true;
  bool _loadingSsid = true;

  @override
  void initState() {
    super.initState();
    _fetchSsid();
  }

  Future<void> _fetchSsid() async {
    setState(() => _loadingSsid = true);
    try {
      final ssid = await _networkInfo.getWifiName();
      if (mounted && ssid != null && ssid.isNotEmpty) {
        // Android returns the SSID wrapped in double quotes.
        setState(() {
          _ssidController.text = ssid.replaceAll('"', '');
        });
      }
    } on Exception catch (e) {
      debugPrint('Failed to fetch Wi-Fi SSID: $e');
    } finally {
      if (mounted) {
        setState(() => _loadingSsid = false);
      }
    }
  }

  @override
  void dispose() {
    _ssidController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Connect to Wi-Fi',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              'The device will use this network to reach SmartCura.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.textSecondary,
                  ),
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            TextField(
              controller: _ssidController,
              decoration: InputDecoration(
                labelText: 'Wi-Fi network name',
                hintText: 'C-14-15 2.4G',
                border: const OutlineInputBorder(),
                helperText: _loadingSsid
                    ? 'Fetching currently connected network...'
                    : 'Auto-fetched from your phone. Edit if needed.',
                suffixIcon: _loadingSsid
                    ? const UnconstrainedBox(
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : IconButton(
                        icon: const Icon(Icons.refresh),
                        tooltip: 'Refresh connected network',
                        onPressed: _fetchSsid,
                      ),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            TextField(
              controller: _passwordController,
              obscureText: _obscurePassword,
              decoration: InputDecoration(
                labelText: 'Wi-Fi password',
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  icon: Icon(_obscurePassword
                      ? Icons.visibility
                      : Icons.visibility_off),
                  onPressed: () =>
                      setState(() => _obscurePassword = !_obscurePassword),
                ),
              ),
            ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () {
                  final ssid = _ssidController.text.trim();
                  final password = _passwordController.text;
                  if (ssid.isNotEmpty) {
                    widget.onSend(ssid, password);
                  }
                },
                child: const Text('Send Wi-Fi Credentials'),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
          ],
        ),
      );
}

class _ProvisioningStep extends StatelessWidget {
  const _ProvisioningStep({required this.state});
  final BleProvisioningState state;

  @override
  Widget build(BuildContext context) {
    final status = state.lastStatus ?? 'Sending credentials...';
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: DesignTokens.spaceLg),
            Text(
              'Provisioning device',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              status,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.textSecondary,
                  ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _SuccessStep extends ConsumerStatefulWidget {
  const _SuccessStep({
    required this.targetDeviceId,
    required this.onDone,
  });
  final String? targetDeviceId;
  final VoidCallback onDone;

  @override
  ConsumerState<_SuccessStep> createState() => _SuccessStepState();
}

class _SuccessStepState extends ConsumerState<_SuccessStep> {
  @override
  void initState() {
    super.initState();
    // Defer to after the current frame — modifying a Riverpod provider
    // inside initState throws "Tried to modify a provider while the widget
    // tree was building" because the tree is not fully constructed yet.
    WidgetsBinding.instance.addPostFrameCallback((_) => _autoAssign());
  }

  Future<void> _autoAssign() async {
    final deviceId = widget.targetDeviceId;
    if (deviceId == null || deviceId.isEmpty) return;

    // Avoid firing two concurrent assignments if the user leaves and returns
    // while one is still in flight. The backend treats an already-assigned-to-self
    // device as success, so re-running on re-entry is safe.
    if (ref.read(assignOwnDeviceProvider).isLoading) return;

    final result =
        await ref.read(assignOwnDeviceProvider.notifier).assign(deviceId);
    if (result is AssignOwnDeviceSuccess) {
      await PendingProvisioningDeviceStore.clearPendingDeviceId();
    } else if (result is AssignOwnDeviceFailure) {
      // Keep the local marker so the device appears as a pending/finish-setup
      // card on the device list until the patient retries or the assignment
      // succeeds.
      await PendingProvisioningDeviceStore.setPendingDeviceId(deviceId);
    }
  }

  Future<void> _retry() async {
    final deviceId = widget.targetDeviceId;
    if (deviceId != null && deviceId.isNotEmpty) {
      await ref.read(assignOwnDeviceProvider.notifier).assign(deviceId);
    }
  }

  @override
  Widget build(BuildContext context) {
    final assignState = ref.watch(assignOwnDeviceProvider);
    final result = assignState.result;
    final isLoading = assignState.isLoading;
    final success = result is AssignOwnDeviceSuccess;
    final failure = result is AssignOwnDeviceFailure;

    return Padding(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      child: Column(
        children: [
          const Spacer(),
          if (isLoading) ...[
            const CircularProgressIndicator(),
            const SizedBox(height: DesignTokens.spaceLg),
          ] else if (success) ...[
            const Icon(Icons.check_circle, size: 80, color: AppColors.success),
            const SizedBox(height: DesignTokens.spaceLg),
          ] else if (failure) ...[
            const Icon(Icons.error_outline, size: 64, color: AppColors.error),
            const SizedBox(height: DesignTokens.spaceLg),
          ],
          Text(
            isLoading
                ? 'Assigning device to your account...'
                : success
                    ? 'Device connected'
                    : 'Could not finish setup',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            isLoading
                ? 'Please wait while we finish linking the SmartCura device to your profile.'
                : success
                    ? 'Your device is now assigned and ready to sync vitals.'
                    : (failure
                        ? (result as AssignOwnDeviceFailure).message
                        : ''),
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.textSecondary,
                ),
            textAlign: TextAlign.center,
          ),
          const Spacer(),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: isLoading
                  ? null
                  : failure
                      ? _retry
                      : widget.onDone,
              child: isLoading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.white,
                      ),
                    )
                  : Text(failure ? 'Retry' : 'Back to My Devices'),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
        ],
      ),
    );
  }
}

class _ErrorStep extends StatelessWidget {
  const _ErrorStep({required this.state, required this.onRetry});
  final BleProvisioningState state;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Column(
          children: [
            const Spacer(),
            const Icon(Icons.error_outline, size: 64, color: AppColors.error),
            const SizedBox(height: DesignTokens.spaceLg),
            Text(
              'Provisioning failed',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              state.errorMessage ?? 'An unknown error occurred.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.textSecondary,
                  ),
              textAlign: TextAlign.center,
            ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: onRetry,
                child: const Text('Start over'),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
          ],
        ),
      );
}

class _StepItem extends StatelessWidget {
  const _StepItem({
    required this.number,
    required this.title,
    required this.body,
  });
  final String number;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: const BoxDecoration(
              color: AppColors.primary,
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Text(
                number,
                style: const TextStyle(
                  color: AppColors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  body,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      );
}
