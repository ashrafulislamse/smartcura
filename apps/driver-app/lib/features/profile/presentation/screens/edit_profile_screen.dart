import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/profile_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Edit profile screen for the driver app.
///
/// Loads the current profile via [profileProvider] and lets the driver edit
/// display name and phone number. Saves via PATCH /profiles/me.
class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _displayNameController = TextEditingController();
  final _phoneController = TextEditingController();
  bool _initialized = false;

  @override
  void dispose() {
    _displayNameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final profileAsync = ref.watch(profileProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Edit Profile'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => context.pop(),
        ),
      ),
      body: profileAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => StateView<dynamic>(
          isLoading: false,
          error: err,
          builder: (_) => const SizedBox.shrink(),
          onRetry: () => ref.invalidate(profileProvider),
        ),
        data: (profile) {
          if (!_initialized) {
            _displayNameController.text = profile.displayName ?? '';
            _phoneController.text = profile.phoneE164 ?? '';
            _initialized = true;
          }
          return SingleChildScrollView(
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.screenPaddingHorizontal,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: DesignTokens.spaceLg),
                _AvatarEditor(profile: profile),
                const SizedBox(height: DesignTokens.spaceLg),
                PremiumCard(
                  child: Column(
                    children: [
                      CustomTextField(
                        label: 'Display Name',
                        controller: _displayNameController,
                        prefixIcon: Icons.person_outline,
                      ),
                      const SizedBox(height: DesignTokens.spaceMd),
                      CustomTextField(
                        label: 'Phone Number',
                        controller: _phoneController,
                        prefixIcon: Icons.phone_outlined,
                        keyboardType: TextInputType.phone,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                Consumer(
                  builder: (context, ref, child) {
                    final mutation = ref.watch(updateProfileProvider);
                    return PrimaryButton(
                      text: mutation.loading ? 'Saving…' : 'Save Changes',
                      icon: Icons.check_rounded,
                      onPressed: mutation.loading
                          ? null
                          : () async {
                              HapticFeedback.lightImpact();
                              final ok = await ref
                                  .read(updateProfileProvider.notifier)
                                  .call(
                                    UpdateMyProfileRequest(
                                      displayName:
                                          _displayNameController.text.trim(),
                                      phoneE164: _phoneController.text.trim(),
                                    ),
                                  );
                              if (!context.mounted) return;
                              if (ok) {
                                AppSnackbar.success(
                                  context,
                                  'Profile updated successfully',
                                );
                                ref.invalidate(profileProvider);
                              } else {
                                AppSnackbar.error(
                                  context,
                                  mutation.error?.displayMessage ??
                                      'Could not update profile',
                                );
                              }
                            },
                    );
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Avatar editor — pick/upload a new photo or remove the existing one.
// ---------------------------------------------------------------------------

class _AvatarEditor extends ConsumerWidget {
  const _AvatarEditor({required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final upload = ref.watch(uploadAvatarProvider);
    final remove = ref.watch(removeAvatarProvider);
    final loading = upload.loading || remove.loading;

    return Center(
      child: Column(
        children: [
          _AvatarImage(profile: profile, loading: loading),
          const SizedBox(height: DesignTokens.spaceSm),
          TextButton.icon(
            onPressed: loading ? null : () => _showOptions(context, ref),
            icon: const Icon(Icons.camera_alt_outlined),
            label: Text(
              profile.avatarUrl == null
                  ? 'Add profile photo'
                  : 'Change profile photo',
            ),
          ),
        ],
      ),
    );
  }

  void _showOptions(BuildContext context, WidgetRef ref) {
    if (profile.avatarUrl == null) {
      _upload(context, ref);
      return;
    }

    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose photo'),
              onTap: () {
                Navigator.pop(ctx);
                _upload(context, ref);
              },
            ),
            ListTile(
              leading:
                  const Icon(Icons.delete_outline, color: AppColors.emergency),
              title: const Text('Remove photo'),
              onTap: () {
                Navigator.pop(ctx);
                _remove(context, ref);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _upload(BuildContext context, WidgetRef ref) async {
    final ok = await ref.read(uploadAvatarProvider.notifier).pickAndUpload();
    if (!context.mounted) return;
    if (ok) {
      AppSnackbar.success(context, 'Profile photo updated');
      ref.invalidate(profileProvider);
    } else {
      AppSnackbar.error(
        context,
        ref.read(uploadAvatarProvider).error?.displayMessage ??
            'Could not upload photo',
      );
    }
  }

  Future<void> _remove(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove profile photo?'),
        content: const Text('Your initials will be used instead.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: AppColors.emergency),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    final ok = await ref.read(removeAvatarProvider.notifier).call();
    if (!context.mounted) return;
    if (ok) {
      AppSnackbar.success(context, 'Profile photo removed');
      ref.invalidate(profileProvider);
    } else {
      AppSnackbar.error(
        context,
        ref.read(removeAvatarProvider).error?.displayMessage ??
            'Could not remove photo',
      );
    }
  }
}

class _AvatarImage extends StatelessWidget {
  const _AvatarImage({required this.profile, required this.loading});
  final Profile profile;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 96,
      height: 96,
      child: Stack(
        alignment: Alignment.center,
        children: [
          AvatarWidget(
            name: profile.displayName,
            imageUrl: profile.avatarUrl,
            size: 96,
          ),
          if (loading)
            Container(
              width: 96,
              height: 96,
              decoration: const BoxDecoration(
                color: Colors.black26,
                shape: BoxShape.circle,
              ),
              child: const CircularProgressIndicator(color: AppColors.white),
            ),
        ],
      ),
    );
  }
}
