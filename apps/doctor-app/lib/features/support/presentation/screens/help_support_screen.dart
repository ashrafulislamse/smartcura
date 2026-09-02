import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/support_ticket_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Help & Support Screen.
///
/// Features:
/// - Searchable FAQ list (static healthcare-app FAQs branded as SmartCura).
/// - Contact support via email / phone (url_launcher).
/// - Submit a support ticket form → `POST /support/tickets` with CSRF, loading
///   state, and success confirmation. The `organization_id` is taken from the
///   caller's active membership.
/// - Resources section (documentation, privacy policy, terms).
///
/// All four resource states are handled for the ticket submission.
class HelpSupportScreen extends ConsumerStatefulWidget {
  const HelpSupportScreen({super.key});

  @override
  ConsumerState<HelpSupportScreen> createState() => _HelpSupportScreenState();
}

/// Static FAQ entries. Healthcare-app-specific and branded as SmartCura.
const _faqs = <_Faq>[
  _Faq(
    question: 'How do I set up my availability schedule?',
    answer:
        'Go to My Schedule from the dashboard, then tap Add Availability Rule. '
        'Choose a weekday, start and end times, and slot duration. Slots are '
        'generated automatically for future dates.',
  ),
  _Faq(
    question: 'How do I start a video consultation?',
    answer:
        'Navigate to the appointment detail page for a confirmed video '
        'appointment and tap Start Video Consultation. A LiveKit room token '
        'is requested from the backend automatically.',
  ),
  _Faq(
    question: 'Can I view my patients\' IoT vital readings?',
    answer:
        'Yes. Open the patient detail page and navigate to the IoT Vitals '
        'section. Real-time readings and health alerts from connected devices '
        '(such as the ESP32 + MAX30102) are displayed there.',
  ),
  _Faq(
    question: 'How do I reset my password?',
    answer:
        'Go to Settings > Privacy & Security > Change Password. A password-'
        'reset email will be sent to your registered email address. Follow '
        'the link in the email to set a new password.',
  ),
  _Faq(
    question: 'How do e-prescriptions work?',
    answer:
        'During or after a consultation, open the E-Prescription screen. '
        'Add medications from the medication catalogue, specify dosage and '
        'instructions, then sign and submit. The prescription status is '
        'tracked from draft through to signed.',
  ),
  _Faq(
    question: 'How are my earnings calculated?',
    answer:
        'Your earnings balance reflects net payouts (gross minus platform '
        'fee) in integer sen. View the breakdown on the Earnings page, '
        'including payout run status and period.',
  ),
  _Faq(
    question: 'What is break-glass access?',
    answer:
        'Break-glass is an emergency access mechanism that grants time-'
        'limited disclosure of a patient\'s allergies and active conditions '
        'when standard access is not available. All break-glass access is '
        'audited.',
  ),
];

const _supportEmail = 'support@smartcura.app';
const _supportPhone = '+60380001234';

class _HelpSupportScreenState extends ConsumerState<HelpSupportScreen> {
  final _searchController = TextEditingController();
  final _subjectController = TextEditingController();
  final _bodyController = TextEditingController();
  String _searchQuery = '';
  String _selectedPriority = 'medium';
  bool _showTicketForm = false;

  static const _priorities = ['low', 'medium', 'high', 'urgent'];

  @override
  void dispose() {
    _searchController.dispose();
    _subjectController.dispose();
    _bodyController.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  List<_Faq> get _filteredFaqs {
    if (_searchQuery.isEmpty) return _faqs;
    final q = _searchQuery.toLowerCase();
    return _faqs
        .where((f) =>
            f.question.toLowerCase().contains(q) ||
            f.answer.toLowerCase().contains(q))
        .toList();
  }

  Future<void> _launchUrl(String url) async {
    final uri = Uri.parse(url);
    try {
      final launched = await launchUrl(uri);
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open $url')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open $url: $e')),
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Submit ticket
  // ------------------------------------------------------------------

  Future<void> _submitTicket() async {
    final subject = _subjectController.text.trim();
    final body = _bodyController.text.trim();
    if (subject.isEmpty || body.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Please fill in the subject and description.'),
            backgroundColor: AppColors.warning),
      );
      return;
    }

    final membershipId = ref.read(activeMembershipIdProvider);
    final memberships = ref.read(membershipsProvider);
    final membership = memberships?.where((m) => m.id == membershipId).firstOrNull;
    final organizationId = membership?.organizationId;

    if (organizationId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('No organization found. Please sign in again.')),
      );
      return;
    }

    // category_code and subject_code follow the snake_case pattern constraint.
    final categoryCode = 'general_inquiry';
    final subjectCode = subject
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
        .replaceAll(RegExp(r'^_+|_+$'), '');
    if (subjectCode.isEmpty || subjectCode.length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Subject must contain at least 2 alphanumeric characters.')),
      );
      return;
    }

    final notifier = ref.read(createSupportTicketProvider.notifier);
    final ok = await notifier.call(
      organizationId: organizationId,
      categoryCode: categoryCode,
      subjectCode: subjectCode,
      body: body,
      priority: _selectedPriority,
    );

    if (!mounted) return;

    if (ok) {
      final result = ref.read(createSupportTicketProvider).value;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'Ticket submitted successfully${result != null ? ' (#${result.supportTicketId.substring(0, 8)})' : ''}'),
          backgroundColor: AppColors.primary,
          duration: const Duration(seconds: 3),
        ),
      );
      _subjectController.clear();
      _bodyController.clear();
      setState(() {
        _showTicketForm = false;
        _selectedPriority = 'medium';
      });
      ref.read(createSupportTicketProvider.notifier).reset();
    } else {
      final err = ref.read(createSupportTicketProvider).error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err is ApiError
              ? err.displayMessage
              : 'Could not submit ticket. Please try again.'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  // ------------------------------------------------------------------
  // Build
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final mutation = ref.watch(createSupportTicketProvider);
    final isSubmitting = mutation.loading;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: AppColors.gray900),
          onPressed: () => context.pop(),
        ),
        title: Text(
          'Help & Support',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.gray900,
              ),
        ),
        centerTitle: true,
      ),
      body: AbsorbPointer(
        absorbing: isSubmitting,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Search
              _buildSearch(),
              const SizedBox(height: DesignTokens.spaceLg),

              // Contact Support
              _buildSectionLabel('Contact Support'),
              _buildContactSection(),

              const SizedBox(height: DesignTokens.spaceXl),

              // FAQ
              _buildSectionLabel('Frequently Asked Questions'),
              _buildFaqSection(),

              const SizedBox(height: DesignTokens.spaceXl),

              // Submit a ticket
              _buildSectionLabel('Submit a Ticket'),
              _buildTicketSection(isSubmitting),

              const SizedBox(height: DesignTokens.spaceXl),

              // Resources
              _buildSectionLabel('Resources'),
              _buildResourcesSection(),

              const SizedBox(height: DesignTokens.spaceXl),
              _buildFooter(),
              const SizedBox(height: DesignTokens.space2xl),
            ],
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------

  Widget _buildSearch() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: SearchBarWidget(
        controller: _searchController,
        hint: 'Search for answers…',
        onChanged: (v) => setState(() => _searchQuery = v),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Contact section
  // ------------------------------------------------------------------

  Widget _buildContactSection() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Column(
        children: [
          _buildContactCard(
            icon: Icons.mail_outline_rounded,
            title: 'Email Support',
            subtitle: _supportEmail,
            onTap: () => _launchUrl('mailto:$_supportEmail'),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildContactCard(
            icon: Icons.call_outlined,
            title: 'Call Support',
            subtitle: _supportPhone,
            onTap: () => _launchUrl('tel:$_supportPhone'),
          ),
        ],
      ),
    );
  }

  Widget _buildContactCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return PremiumCard(
      onTap: onTap,
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: AppColors.primary, size: DesignTokens.iconMd),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppColors.gray900,
                      ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: AppColors.gray500,
                      ),
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right_rounded,
              color: AppColors.gray400, size: DesignTokens.iconMd),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // FAQ section
  // ------------------------------------------------------------------

  Widget _buildFaqSection() {
    final faqs = _filteredFaqs;
    if (faqs.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
        child: EmptyView(
          icon: Icons.search_off_rounded,
          title: 'No results found',
          body: 'Try a different search term.',
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Column(
        children: [
          for (int i = 0; i < faqs.length; i++) ...[
            _buildFaqItem(faqs[i]),
            if (i < faqs.length - 1)
              const SizedBox(height: DesignTokens.spaceSm),
          ],
        ],
      ),
    );
  }

  Widget _buildFaqItem(_Faq faq) {
    return ExpansionTile(
      tilePadding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceMd, vertical: 0),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        side: const BorderSide(color: AppColors.gray200, width: 1),
      ),
      collapsedShape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        side: const BorderSide(color: AppColors.gray200, width: 1),
      ),
      backgroundColor: AppColors.white,
      collapsedBackgroundColor: AppColors.white,
      iconColor: AppColors.primary,
      collapsedIconColor: AppColors.gray500,
      title: Text(
        faq.question,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.gray900,
            ),
      ),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
              DesignTokens.spaceMd, 0, DesignTokens.spaceMd, DesignTokens.spaceMd),
          child: Text(
            faq.answer,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray600,
                  height: 1.5,
                ),
          ),
        ),
      ],
    );
  }

  // ------------------------------------------------------------------
  // Ticket section
  // ------------------------------------------------------------------

  Widget _buildTicketSection(bool isSubmitting) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: PremiumCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!_showTicketForm)
              Column(
                children: [
                  Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: AppColors.primaryContainer,
                          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                        ),
                        child: const Icon(Icons.support_agent_rounded,
                            color: AppColors.primary, size: DesignTokens.iconMd),
                      ),
                      const SizedBox(width: DesignTokens.spaceMd),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Can\'t find what you need?',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleSmall
                                  ?.copyWith(
                                    fontWeight: FontWeight.bold,
                                    color: AppColors.gray900,
                                  ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Submit a support ticket and our team will get back to you.',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(color: AppColors.gray500),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () =>
                          setState(() => _showTicketForm = true),
                      icon: const Icon(Icons.add_rounded, size: 20),
                      label: const Text('Open Ticket Form'),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: AppColors.white,
                        padding: const EdgeInsets.symmetric(
                            vertical: DesignTokens.spaceSm + 2),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusMd),
                        ),
                      ),
                    ),
                  ),
                ],
              )
            else
              _buildTicketForm(isSubmitting),
          ],
        ),
      ),
    );
  }

  Widget _buildTicketForm(bool isSubmitting) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'New Support Ticket',
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.gray900,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),

        // Subject
        Text(
          'Subject',
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray700,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceXs + 2),
        TextField(
          controller: _subjectController,
          enabled: !isSubmitting,
          decoration: _inputDecoration('Briefly describe your issue'),
        ),

        const SizedBox(height: DesignTokens.spaceMd),

        // Priority
        Text(
          'Priority',
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray700,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceXs + 2),
        Wrap(
          spacing: DesignTokens.spaceSm,
          children: _priorities.map((p) {
            final selected = _selectedPriority == p;
            return ChoiceChip(
              label: Text(p[0].toUpperCase() + p.substring(1)),
              selected: selected,
              onSelected: isSubmitting
                  ? null
                  : (_) => setState(() => _selectedPriority = p),
              selectedColor: AppColors.primaryContainer,
              labelStyle: TextStyle(
                color: selected ? AppColors.primaryDark : AppColors.gray700,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                side: BorderSide(
                  color: selected ? AppColors.primary : AppColors.gray200,
                ),
              ),
            );
          }).toList(),
        ),

        const SizedBox(height: DesignTokens.spaceMd),

        // Description
        Text(
          'Description',
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray700,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceXs + 2),
        TextField(
          controller: _bodyController,
          enabled: !isSubmitting,
          maxLines: 5,
          maxLength: 8000,
          decoration: _inputDecoration(
              'Describe your issue in detail…', counter: true),
        ),

        const SizedBox(height: DesignTokens.spaceMd),

        // Action buttons
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: isSubmitting
                    ? null
                    : () => setState(() => _showTicketForm = false),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.gray600,
                  side: const BorderSide(color: AppColors.gray200, width: 1.5),
                  padding: const EdgeInsets.symmetric(
                      vertical: DesignTokens.spaceSm + 2),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                ),
                child: const Text('Cancel'),
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm + 2),
            Expanded(
              child: FilledButton(
                onPressed: isSubmitting ? null : _submitTicket,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: AppColors.white,
                  disabledBackgroundColor: AppColors.primary.withValues(alpha: 0.6),
                  padding: const EdgeInsets.symmetric(
                      vertical: DesignTokens.spaceSm + 2),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                ),
                child: isSubmitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.white,
                        ),
                      )
                    : const Text(
                        'Submit',
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  InputDecoration _inputDecoration(String hint, {bool counter = false}) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: AppColors.surfaceVariant,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        borderSide: const BorderSide(color: AppColors.gray200),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        borderSide: const BorderSide(color: AppColors.gray200),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
      ),
      contentPadding: const EdgeInsets.all(DesignTokens.spaceMd),
      counterText: counter ? null : '',
    );
  }

  // ------------------------------------------------------------------
  // Resources section
  // ------------------------------------------------------------------

  Widget _buildResourcesSection() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Column(
        children: [
          _buildResourceCard(
            icon: Icons.menu_book_outlined,
            iconTone: StatTone.primary,
            title: 'Documentation',
            subtitle: 'User guides and references',
            onTap: () => _launchUrl('https://smartcura.app/docs'),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildResourceCard(
            icon: Icons.privacy_tip_outlined,
            iconTone: StatTone.info,
            title: 'Privacy Policy',
            subtitle: 'How we handle your data',
            onTap: () => _launchUrl('https://smartcura.app/privacy'),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildResourceCard(
            icon: Icons.description_outlined,
            iconTone: StatTone.neutral,
            title: 'Terms of Service',
            subtitle: 'Terms and conditions',
            onTap: () => _launchUrl('https://smartcura.app/terms'),
          ),
        ],
      ),
    );
  }

  Widget _buildResourceCard({
    required IconData icon,
    required StatTone iconTone,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return PremiumCard(
      onTap: onTap,
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: _toneContainer(iconTone),
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: Icon(icon, color: _toneFg(iconTone), size: DesignTokens.iconMd),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: AppColors.gray900,
                      ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.gray500,
                      ),
                ),
              ],
            ),
          ),
          const Icon(Icons.open_in_new_rounded,
              color: AppColors.gray400, size: DesignTokens.iconSm),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Shared builders
  // ------------------------------------------------------------------

  Widget _buildSectionLabel(String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          DesignTokens.spaceMd + 4, 0, DesignTokens.spaceMd, DesignTokens.spaceSm),
      child: Text(
        text,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.bold,
              color: AppColors.gray900,
            ),
      ),
    );
  }

  Widget _buildFooter() {
    return Center(
      child: Column(
        children: [
          Text(
            'SmartCura for Doctors',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w500,
                  color: AppColors.gray500,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceXs),
          Text(
            'Version 1.0.0',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: AppColors.gray400,
                ),
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Tone color helpers
  // ------------------------------------------------------------------

  Color _toneContainer(StatTone tone) => switch (tone) {
        StatTone.primary => AppColors.primaryContainer,
        StatTone.success => AppColors.successContainer,
        StatTone.warning => AppColors.warningContainer,
        StatTone.error => AppColors.errorContainer,
        StatTone.info => AppColors.infoContainer,
        StatTone.neutral => AppColors.gray100,
      };

  Color _toneFg(StatTone tone) => switch (tone) {
        StatTone.primary => AppColors.primary,
        StatTone.success => AppColors.success,
        StatTone.warning => AppColors.warning,
        StatTone.error => AppColors.error,
        StatTone.info => AppColors.info,
        StatTone.neutral => AppColors.gray500,
      };
}

/// Internal FAQ model.
class _Faq {
  const _Faq({required this.question, required this.answer});
  final String question;
  final String answer;
}
