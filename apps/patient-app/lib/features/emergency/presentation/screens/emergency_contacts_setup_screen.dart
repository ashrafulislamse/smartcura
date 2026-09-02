import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/profile_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../../core/widgets/status_badge.dart';

/// Emergency Contacts Setup Screen
///
/// Wires to real backend endpoints:
///  - GET  /profiles/me/emergency-contacts  (list)
///  - POST /profiles/me/emergency-contacts  (create)
///  - PATCH /profiles/me/emergency-contacts/{id} (edit)
///  - DELETE /profiles/me/emergency-contacts/{id} (delete)
///
/// All four resource states (loading, error, empty, loaded) are handled via
/// [StateView]. Pull-to-refresh invalidates the provider.
class EmergencyContactsSetupScreen extends ConsumerStatefulWidget {
  const EmergencyContactsSetupScreen({super.key});

  @override
  ConsumerState<EmergencyContactsSetupScreen> createState() =>
      _EmergencyContactsSetupScreenState();
}

class _EmergencyContactsSetupScreenState
    extends ConsumerState<EmergencyContactsSetupScreen> {
  @override
  Widget build(BuildContext context) {
    final contactsAsync = ref.watch(emergencyContactsProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: _buildAppBar(),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(emergencyContactsProvider),
        child: contactsAsync.when(
          loading: () => const Center(
            child: CircularProgressIndicator(color: AppColors.primary),
          ),
          error: (err, _) => ErrorView(
            message: err is ApiError ? err.userMessage : err.toString(),
            onRetry: () => ref.invalidate(emergencyContactsProvider),
          ),
          data: (contacts) => contacts.isEmpty
              ? ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: [
                    SizedBox(height: MediaQuery.of(context).size.height * 0.3),
                    const EmptyView(
                      title: 'No emergency contacts yet',
                      body:
                          'Add one for safety — trusted people will be notified automatically in a medical emergency.',
                      icon: Icons.contact_emergency_outlined,
                      illustrationAsset:
                          'assets/illustrations/empty_emergency_contacts.svg',
                    ),
                  ],
                )
              : _buildContactList(contacts),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showAddContactSheet,
        icon: const Icon(Icons.person_add),
        label: const Text('Add Contact'),
        backgroundColor: AppColors.emergency,
        foregroundColor: AppColors.white,
      ),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: AppColors.surface,
      elevation: 0,
      leading: IconButton(
        icon:
            const Icon(Icons.arrow_back_ios_new, color: AppColors.textPrimary),
        onPressed: () => context.pop(),
      ),
      title: const Text(
        'Emergency Contacts',
        style: TextStyle(
          color: AppColors.textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.bold,
        ),
      ),
      centerTitle: true,
    );
  }

  Widget _buildContactList(List<EmergencyContact> contacts) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.screenPaddingHorizontal,
        DesignTokens.spaceMd,
        DesignTokens.screenPaddingHorizontal,
        100,
      ),
      itemCount: contacts.length,
      itemBuilder: (context, index) {
        final contact = contacts[index];
        return _ContactCard(
          contact: contact,
          onEdit: () => _showEditContactSheet(contact),
          onDelete: () => _confirmDelete(contact),
          onCall: () => _callContact(contact.phoneE164),
        );
      },
    );
  }

  Future<void> _callContact(String phoneE164) async {
    HapticFeedback.lightImpact();
    final uri = Uri.parse('tel:$phoneE164');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  void _showAddContactSheet() {
    _showContactFormSheet(contact: null);
  }

  void _showEditContactSheet(EmergencyContact contact) {
    _showContactFormSheet(contact: contact);
  }

  void _showContactFormSheet({EmergencyContact? contact}) {
    final isEdit = contact != null;
    final nameController = TextEditingController(text: contact?.name ?? '');
    final phoneController =
        TextEditingController(text: contact?.phoneE164 ?? '');
    final relationshipController =
        TextEditingController(text: contact?.relationship ?? '');
    final formKey = GlobalKey<FormState>();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            final mutationState = ref.watch(emergencyContactMutationProvider);

            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(ctx).viewInsets.bottom,
              ),
              child: Form(
                key: formKey,
                child: Padding(
                  padding: const EdgeInsets.all(DesignTokens.spaceLg),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Center(
                        child: Container(
                          width: 40,
                          height: 4,
                          margin: const EdgeInsets.only(
                              bottom: DesignTokens.spaceLg),
                          decoration: BoxDecoration(
                            color: AppColors.gray300,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                      ),
                      Text(
                        isEdit ? 'Edit Contact' : 'Add Emergency Contact',
                        style: Theme.of(ctx).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.bold,
                              color: AppColors.textPrimary,
                            ),
                      ),
                      const SizedBox(height: DesignTokens.spaceLg),
                      _SheetField(
                        label: 'Name',
                        controller: nameController,
                        icon: Icons.person_outline,
                        validator: (v) => (v == null || v.trim().isEmpty)
                            ? 'Name is required'
                            : null,
                      ),
                      const SizedBox(height: DesignTokens.spaceMd),
                      _SheetField(
                        label: 'Phone (E.164)',
                        controller: phoneController,
                        icon: Icons.phone_outlined,
                        keyboardType: TextInputType.phone,
                        hint: '+1 555 123 4567',
                        validator: (v) => (v == null || v.trim().isEmpty)
                            ? 'Phone is required'
                            : null,
                      ),
                      const SizedBox(height: DesignTokens.spaceMd),
                      _SheetField(
                        label: 'Relationship',
                        controller: relationshipController,
                        icon: Icons.people_outline,
                        hint: 'Spouse, Parent, Sibling…',
                        validator: (v) => (v == null || v.trim().isEmpty)
                            ? 'Relationship is required'
                            : null,
                      ),
                      const SizedBox(height: DesignTokens.spaceLg),
                      if (mutationState is AsyncLoading)
                        const Padding(
                          padding: EdgeInsets.symmetric(
                              vertical: DesignTokens.spaceMd),
                          child: Center(
                            child: CircularProgressIndicator(
                                color: AppColors.emergency),
                          ),
                        )
                      else if (mutationState is AsyncError)
                        Padding(
                          padding: const EdgeInsets.only(
                              bottom: DesignTokens.spaceMd),
                          child: Text(
                            mutationState.error is ApiError
                                ? (mutationState.error as ApiError).userMessage
                                : 'An error occurred',
                            style: const TextStyle(
                                color: AppColors.error, fontSize: 13),
                          ),
                        ),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: () async => _submitContactForm(
                            isEdit: isEdit,
                            contact: contact,
                            name: nameController.text.trim(),
                            phone: phoneController.text.trim(),
                            relationship: relationshipController.text.trim(),
                            formKey: formKey,
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.emergency,
                            foregroundColor: AppColors.white,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: Text(
                            isEdit ? 'Save Changes' : 'Add Contact',
                            style: const TextStyle(
                                fontSize: 16, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceMd),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _submitContactForm({
    required bool isEdit,
    EmergencyContact? contact,
    required String name,
    required String phone,
    required String relationship,
    required GlobalKey<FormState> formKey,
  }) async {
    if (!formKey.currentState!.validate()) return;

    final notifier = ref.read(emergencyContactMutationProvider.notifier);

    if (isEdit && contact != null) {
      await notifier.update(
        contactId: contact.id,
        name: name,
        relationship: relationship,
        phoneE164: phone,
        reasonCode: 'patient_initiated',
        expectedVersion: contact.version,
      );
    } else {
      await notifier.create(
        name: name,
        relationship: relationship,
        phoneE164: phone,
        reasonCode: 'patient_initiated',
      );
    }

    final state = ref.read(emergencyContactMutationProvider);
    if (state is AsyncData && mounted) {
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(isEdit ? 'Contact updated' : 'Contact added'),
          backgroundColor: AppColors.success,
        ),
      );
    }
  }

  void _confirmDelete(EmergencyContact contact) {
    HapticFeedback.mediumImpact();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Delete Contact?',
            style: TextStyle(
                fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
        content: Text(
          'Remove ${contact.name} from your emergency contacts?',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              await ref.read(emergencyContactMutationProvider.notifier).delete(
                    contactId: contact.id,
                    reasonCode: 'patient_initiated',
                    expectedVersion: contact.version,
                  );
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Contact deleted'),
                    backgroundColor: AppColors.error,
                  ),
                );
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: AppColors.white,
            ),
            child: const Text('Delete',
                style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Contact card widget
// ---------------------------------------------------------------------------

class _ContactCard extends StatelessWidget {
  final EmergencyContact contact;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onCall;

  const _ContactCard({
    required this.contact,
    required this.onEdit,
    required this.onDelete,
    required this.onCall,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: const [
          BoxShadow(
              color: AppColors.shadow, blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Row(
        children: [
          AvatarWidget(name: contact.name, size: 48),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        contact.name,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: DesignTokens.spaceSm),
                    if (contact.isPrimary)
                      const StatusBadge(
                        text: 'PRIMARY',
                        tone: StatusTone.error,
                        small: true,
                      )
                    else
                      StatusBadge(
                        text: contact.relationship.toUpperCase(),
                        tone: StatusTone.neutral,
                        small: true,
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  contact.phoneE164,
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 14),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.call, color: AppColors.secondary, size: 20),
            onPressed: onCall,
            tooltip: 'Call',
          ),
          IconButton(
            icon: const Icon(Icons.edit_outlined,
                color: AppColors.primary, size: 20),
            onPressed: onEdit,
            tooltip: 'Edit',
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline,
                color: AppColors.error, size: 20),
            onPressed: onDelete,
            tooltip: 'Delete',
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Bottom-sheet form field
// ---------------------------------------------------------------------------

class _SheetField extends StatelessWidget {
  final String label;
  final TextEditingController controller;
  final IconData icon;
  final TextInputType? keyboardType;
  final String? hint;
  final String? Function(String?)? validator;

  const _SheetField({
    required this.label,
    required this.controller,
    required this.icon,
    this.keyboardType,
    this.hint,
    this.validator,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary,
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          validator: validator,
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(color: AppColors.textDisabled),
            prefixIcon: Icon(icon, color: AppColors.primary, size: 20),
            filled: true,
            fillColor: AppColors.gray50,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.gray200),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.gray200),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.primary, width: 2),
            ),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          ),
          style: const TextStyle(fontSize: 15, color: AppColors.textPrimary),
        ),
      ],
    );
  }
}
