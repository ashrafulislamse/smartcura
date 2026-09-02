import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Document upload screen — captures real document photos with the camera or
/// gallery and uploads them to the SmartCura verification-documents endpoint.
///
/// The backend uses a three-step upload flow (see the OpenAPI spec for
/// `/memberships/{membership_id}/verification-documents`):
///   1. `POST .../verification-documents` with the declared SHA-256, content
///      type and byte size → returns a short-lived pre-signed `upload` target.
///   2. `PUT` the raw bytes to the pre-signed URL with the required headers.
///   3. `POST .../verification-documents/{document_id}/finalize` with the
///      reported SHA-256 so the server verifies the checksum.
///
/// The membership id comes from the authenticated session ([authProvider]); if
/// there is none the screen shows a "sign in required" state. [image_picker]
/// re-encodes captured images to JPEG, which is one of the three accepted
/// media types, so the declared content type is always `image/jpeg`.
class DocumentUploadScreen extends ConsumerStatefulWidget {
  const DocumentUploadScreen({super.key});

  @override
  ConsumerState<DocumentUploadScreen> createState() =>
      _DocumentUploadScreenState();
}

class _DocumentUploadScreenState extends ConsumerState<DocumentUploadScreen> {
  /// The document kinds a driver must supply, mapped to UI labels and icons.
  /// These wire values match the `VerificationDocumentKind` enum in the
  /// contracts: `driving_licence`, `national_id`, `vehicle_registration`.
  static const _documents = <_DocSpec>[
    _DocSpec(
      kind: 'driving_licence',
      label: 'Driving Licence',
      icon: Icons.badge_outlined,
    ),
    _DocSpec(
      kind: 'national_id',
      label: 'National ID / Passport',
      icon: Icons.credit_card_outlined,
    ),
    _DocSpec(
      kind: 'vehicle_registration',
      label: 'Vehicle Registration',
      icon: Icons.directions_car_outlined,
    ),
  ];

  final ImagePicker _picker = ImagePicker();
  final Map<String, _DocState> _states = {
    for (final d in _documents) d.kind: _DocState(),
  };
  bool _submitting = false;

  int get _uploadedCount =>
      _states.values.where((s) => s.status == _UploadStatus.uploaded).length;
  bool get _canSubmit => _uploadedCount == _documents.length;

  /// Pick an image from camera or gallery after requesting the relevant
  /// permission. Returns null when the user cancels or permission is denied.
  Future<XFile?> _pickImage(ImageSource source) async {
    final granted = source == ImageSource.camera
        ? await _requestCameraPermission()
        : await _requestGalleryPermission();
    if (!granted) {
      _showSnack('Permission denied. Enable it in app settings to continue.');
      return null;
    }
    try {
      return await _picker.pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 1600,
        maxHeight: 1600,
      );
    } on PlatformException catch (e) {
      _showSnack('Could not capture image: ${e.message ?? e.code}');
      return null;
    }
  }

  Future<bool> _requestCameraPermission() async {
    final status = await Permission.camera.request();
    return status.isGranted || status.isLimited;
  }

  Future<bool> _requestGalleryPermission() async {
    if (Platform.isAndroid) {
      final sdk = await _androidSdkInt();
      if (sdk != null && sdk >= 33) {
        final s = await Permission.photos.request();
        return s.isGranted || s.isLimited;
      }
      final s = await Permission.storage.request();
      return s.isGranted || s.isLimited;
    }
    final s = await Permission.photos.request();
    return s.isGranted || s.isLimited;
  }

  Future<int?> _androidSdkInt() async {
    try {
      final info = await DeviceInfoPlugin().androidInfo;
      return info.version.sdkInt;
    } catch (_) {
      return null;
    }
  }

  /// Run the full three-step upload flow for one document kind.
  Future<void> _uploadDocument(_DocSpec spec) async {
    final source = await _chooseSource();
    if (source == null) return;

    final xfile = await _pickImage(source);
    if (xfile == null) return;

    final bytes = await xfile.readAsBytes();
    final shaHex = sha256.convert(bytes).toString();
    // image_picker re-encodes to JPEG when imageQuality is set.
    const contentType = 'image/jpeg';

    final mid = ref.read(activeMembershipIdProvider);
    if (mid == null) {
      _showSnack('Sign in required before uploading documents.');
      return;
    }

    setState(() {
      _states[spec.kind] = _DocState(
        file: xfile,
        status: _UploadStatus.uploading,
      );
    });

    try {
      final api = ref.read(apiClientProvider);

      // 1. Request a short-lived upload target.
      final target = await api.post(
        '/memberships/$mid/verification-documents',
        body: <String, dynamic>{
          'document_kind': spec.kind,
          'content_type': contentType,
          'byte_size': bytes.length,
          'declared_sha256': shaHex,
        },
      );
      final document = target['document'] as Map<String, dynamic>;
      final documentId = document['document_id'] as String;
      final upload = target['upload'] as Map<String, dynamic>;
      final url = upload['url'] as String;
      final rawHeaders = upload['required_headers'];
      final headers = <String, String>{};
      if (rawHeaders is Map) {
        for (final entry in rawHeaders.entries) {
          headers[entry.key.toString()] = entry.value.toString();
        }
      }

      // 2. PUT the raw bytes to the pre-signed storage URL. A bare Dio is used
      //    so the session/CSRF interceptors do not attach to an external host.
      final storageDio = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 30),
        sendTimeout: const Duration(seconds: 120),
        receiveTimeout: const Duration(seconds: 60),
      ));
      try {
        await storageDio.put(
          url,
          data: bytes,
          options: Options(headers: headers),
        );
      } finally {
        storageDio.close(force: true);
      }

      // 3. Finalize so the server verifies the checksum and queues the scan.
      await api.post(
        '/memberships/$mid/verification-documents/$documentId/finalize',
        body: <String, dynamic>{'reported_sha256': shaHex},
      );

      if (!mounted) return;
      setState(() {
        _states[spec.kind] = _DocState(
          file: xfile,
          status: _UploadStatus.uploaded,
          documentId: documentId,
        );
      });
      HapticFeedback.lightImpact();
      _showSnack('${spec.label} uploaded.');
    } catch (e) {
      if (kDebugMode) debugPrint('Document upload failed: $e');
      if (!mounted) return;
      setState(() {
        _states[spec.kind] = _DocState(
          file: xfile,
          status: _UploadStatus.failed,
          error: _friendlyError(e),
        );
      });
    }
  }

  /// Bottom sheet letting the driver choose camera or gallery.
  Future<ImageSource?> _chooseSource() async {
    return showModalBottomSheet<ImageSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt_rounded),
              title: const Text('Take Photo'),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('Choose from Gallery'),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (!_canSubmit) return;
    HapticFeedback.mediumImpact();
    setState(() => _submitting = true);
    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (!mounted) return;
    setState(() => _submitting = false);
    _showSnack('Documents submitted for review.');
    context.go('/verification-pending');
  }

  void _showSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  String _friendlyError(Object e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['detail'] is String) return data['detail'] as String;
      if (data is Map && data['title'] is String) return data['title'] as String;
      return e.message ?? 'Upload failed.';
    }
    return e.toString();
  }

  @override
  Widget build(BuildContext context) {
    final mid = ref.watch(activeMembershipIdProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: _submitting ? null : () => context.pop(),
        ),
        title: const Text('Document Upload'),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceLg,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: DesignTokens.spaceSm),
                  Text(
                    'Verification Documents',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXs),
                  Text(
                    'Upload clear photos of your documents. '
                    'All three are required for verification.',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.textSecondary,
                          height: DesignTokens.lineHeightNormal,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),
                  _ProgressSummary(
                    uploaded: _uploadedCount,
                    total: _documents.length,
                  ),
                ],
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            if (mid == null)
              const Padding(
                padding: EdgeInsets.all(DesignTokens.spaceLg),
                child: FirebaseNotConfiguredCard(
                  feature: 'session — sign in to upload documents',
                ),
              )
            else
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceLg,
                  ),
                  itemCount: _documents.length,
                  itemBuilder: (context, i) {
                    final spec = _documents[i];
                    final state = _states[spec.kind]!;
                    return _DocumentCard(
                      spec: spec,
                      state: state,
                      onUpload: _submitting
                          ? null
                          : () => _uploadDocument(spec),
                    );
                  },
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(DesignTokens.spaceLg),
              child: PrimaryButton(
                text: _canSubmit
                    ? 'Submit for Review'
                    : 'Upload all ${_documents.length} documents',
                icon: Icons.check_circle_rounded,
                isLoading: _submitting,
                onPressed: _canSubmit ? _submit : null,
                height: DesignTokens.buttonHeightLg,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

enum _UploadStatus { idle, uploading, uploaded, failed }

class _DocSpec {
  const _DocSpec({
    required this.kind,
    required this.label,
    required this.icon,
  });

  final String kind;
  final String label;
  final IconData icon;
}

class _DocState {
  _DocState({
    this.file,
    this.status = _UploadStatus.idle,
    this.documentId,
    this.error,
  });

  final XFile? file;
  final _UploadStatus status;
  final String? documentId;
  final String? error;
}

// ---------------------------------------------------------------------------
// Sub-widgets
// ---------------------------------------------------------------------------

class _ProgressSummary extends StatelessWidget {
  const _ProgressSummary({required this.uploaded, required this.total});

  final int uploaded;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.15)),
      ),
      child: Row(
        children: [
          Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                width: 44,
                height: 44,
                child: CircularProgressIndicator(
                  value: total == 0 ? 0 : uploaded / total,
                  backgroundColor: AppColors.borderLight,
                  color: AppColors.primary,
                  strokeWidth: 3,
                ),
              ),
              Text(
                '$uploaded',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$uploaded of $total uploaded',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 2),
                const Text(
                  'All documents required',
                  style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DocumentCard extends StatelessWidget {
  const _DocumentCard({
    required this.spec,
    required this.state,
    required this.onUpload,
  });

  final _DocSpec spec;
  final _DocState state;
  final VoidCallback? onUpload;

  @override
  Widget build(BuildContext context) {
    final isUploaded = state.status == _UploadStatus.uploaded;
    final isUploading = state.status == _UploadStatus.uploading;

    return PremiumCard(
      margin: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      accentColor: isUploaded
          ? AppColors.success
          : state.status == _UploadStatus.failed
              ? AppColors.error
              : null,
      child: Row(
        children: [
          // Preview tile or placeholder.
          _PreviewTile(state: state, icon: spec.icon),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  spec.label,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                _StatusLabel(state: state),
              ],
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          if (isUploading)
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else
            PrimaryButton(
              text: isUploaded ? 'Retake' : 'Upload',
              onPressed: onUpload,
              height: DesignTokens.buttonHeightSm,
              backgroundColor:
                  isUploaded ? AppColors.success : AppColors.primary,
            ),
        ],
      ),
    );
  }
}

class _PreviewTile extends StatelessWidget {
  const _PreviewTile({required this.state, required this.icon});

  final _DocState state;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final file = state.file;
    if (file != null) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        child: Image.file(
          File(file.path),
          width: 64,
          height: 64,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => _placeholder(),
        ),
      );
    }
    return _placeholder();
  }

  Widget _placeholder() {
    return Container(
      width: 64,
      height: 64,
      decoration: BoxDecoration(
        color: AppColors.gray100,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
      ),
      child: Icon(icon, color: AppColors.textSecondary, size: 28),
    );
  }
}

class _StatusLabel extends StatelessWidget {
  const _StatusLabel({required this.state});

  final _DocState state;

  @override
  Widget build(BuildContext context) {
    switch (state.status) {
      case _UploadStatus.uploaded:
        return const Row(
          children: [
            Icon(Icons.check_circle_rounded, color: AppColors.success, size: 14),
            SizedBox(width: 4),
            Text(
              'Uploaded',
              style: TextStyle(fontSize: 12, color: AppColors.success, fontWeight: FontWeight.w600),
            ),
          ],
        );
      case _UploadStatus.uploading:
        return const Text(
          'Uploading…',
          style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
        );
      case _UploadStatus.failed:
        return Text(
          state.error ?? 'Upload failed. Try again.',
          style: const TextStyle(fontSize: 12, color: AppColors.error),
        );
      case _UploadStatus.idle:
        return const Text(
          'Not uploaded',
          style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
        );
    }
  }
}
