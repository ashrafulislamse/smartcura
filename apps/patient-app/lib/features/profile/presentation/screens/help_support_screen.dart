import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/notification_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/loading_overlay.dart';
import '../../../../core/widgets/premium_card.dart';

/// Help & Support Screen
///
/// Features:
///  - Searchable static FAQ list (filtered client-side).
///  - Contact support form that POSTs to /support/tickets via
///    [createSupportTicketProvider].
///  - Resource links (user guide, report a bug).
///
/// No hardcoded contact phone numbers — the support ticket is the primary
/// contact channel, matching the backend's support-ticket workflow.
class HelpSupportScreen extends ConsumerStatefulWidget {
  const HelpSupportScreen({super.key});

  @override
  ConsumerState<HelpSupportScreen> createState() => _HelpSupportScreenState();
}

// ---------------------------------------------------------------------------
// Static FAQ data
// ---------------------------------------------------------------------------

class _FaqItem {
  final IconData icon;
  final String question;
  final String answer;

  const _FaqItem({
    required this.icon,
    required this.question,
    required this.answer,
  });
}

const _faqs = <_FaqItem>[
  _FaqItem(
    icon: Icons.calendar_month,
    question: 'How do I reschedule an appointment?',
    answer:
        'Go to "Appointments", select the booking you want to change, and tap "Reschedule". '
        'Choose a new time slot that suits you and confirm.',
  ),
  _FaqItem(
    icon: Icons.medication,
    question: 'Where can I find my prescriptions?',
    answer:
        'Your digital prescriptions are securely stored in the Prescriptions section. '
        'You can view details or share them directly with pharmacies from there.',
  ),
  _FaqItem(
    icon: Icons.verified_user,
    question: 'How do I update my insurance details?',
    answer: 'Insurance management is handled by your healthcare provider. '
        'Please contact support or ask at your next visit.',
  ),
  _FaqItem(
    icon: Icons.emergency,
    question: 'What happens when I press SOS?',
    answer:
        'Pressing SOS creates an emergency event in the system. Your location '
        '(if available) and medical information are shared with the response team, '
        'and your emergency contacts are notified.',
  ),
  _FaqItem(
    icon: Icons.devices,
    question: 'How do I pair my IoT health device?',
    answer: 'Go to the IoT section from the home screen, select "Pair Device", '
        'and follow the on-screen instructions to connect your sensor via Bluetooth.',
  ),
  _FaqItem(
    icon: Icons.lock,
    question: 'Is my health data secure?',
    answer:
        'Yes. All health data is encrypted in transit and at rest. Access is '
        'controlled by your organization and requires authentication.',
  ),
];

class _HelpSupportScreenState extends ConsumerState<HelpSupportScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;

  final _searchController = TextEditingController();
  final _subjectController = TextEditingController();
  final _bodyController = TextEditingController();
  String _selectedCategory = 'general';
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeOut),
    );
    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, 0.1),
      end: Offset.zero,
    ).animate(CurvedAnimation(
        parent: _animationController, curve: Curves.easeOutCubic));
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    _searchController.dispose();
    _subjectController.dispose();
    _bodyController.dispose();
    super.dispose();
  }

  List<_FaqItem> get _filteredFaqs {
    if (_searchQuery.isEmpty) return _faqs;
    final q = _searchQuery.toLowerCase();
    return _faqs.where((f) {
      return f.question.toLowerCase().contains(q) ||
          f.answer.toLowerCase().contains(q);
    }).toList();
  }

  Future<void> _submitTicket() async {
    if (_subjectController.text.trim().isEmpty ||
        _bodyController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please fill in the subject and description.'),
          backgroundColor: AppColors.warning,
        ),
      );
      return;
    }

    final orgId = ref.read(currentOrganizationIdProvider);
    if (orgId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('You are not a member of any organization.'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }

    final created = await ref.read(createSupportTicketProvider.notifier).create(
          organizationId: orgId,
          categoryCode: _selectedCategory,
          subjectCode: _subjectController.text.trim(),
          body: _bodyController.text.trim(),
        );

    if (created != null && mounted) {
      _subjectController.clear();
      _bodyController.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'Support ticket created (ID: ${created.supportTicketId.substring(0, 8)}…)'),
          backgroundColor: AppColors.success,
        ),
      );
    } else if (mounted) {
      final state = ref.read(createSupportTicketProvider);
      if (state is AsyncError) {
        final err = state.error;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
                err is ApiError ? err.userMessage : 'Failed to create ticket'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  void _showUserGuide(BuildContext context) {
    HapticFeedback.lightImpact();
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.menu_book, color: AppColors.primary),
            SizedBox(width: 8),
            Text('User Guide'),
          ],
        ),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Home',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: AppColors.textPrimary,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'See your next appointment, recent vitals, and quick actions.',
                style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
              ),
              SizedBox(height: 12),
              Text(
                'Health',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: AppColors.textPrimary,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'Review trends, sync vitals from your watch via Health Connect, '
                'and manage connected devices.',
                style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
              ),
              SizedBox(height: 12),
              Text(
                'Messages',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: AppColors.textPrimary,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'Chat with your doctor after a consultation starts, or ask the AI '
                'assistant health questions.',
                style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
              ),
              SizedBox(height: 12),
              Text(
                'Profile',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: AppColors.textPrimary,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'Update your name and contact details, set notification preferences, '
                'and contact support.',
                style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
              ),
              SizedBox(height: 12),
              Text(
                'Need more help?',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: AppColors.textPrimary,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'Use the contact form below to open a support ticket.',
                style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Stack(
          children: [
            Column(
              children: [
                _buildHeader(),
                Expanded(
                  child: FadeTransition(
                    opacity: _fadeAnimation,
                    child: SlideTransition(
                      position: _slideAnimation,
                      child: SingleChildScrollView(
                        physics: const BouncingScrollPhysics(),
                        child: Padding(
                          padding: const EdgeInsets.all(DesignTokens.spaceMd),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const SizedBox(height: DesignTokens.spaceSm),
                              _buildSearchBar(),
                              const SizedBox(height: DesignTokens.spaceLg),
                              _buildContactForm(),
                              const SizedBox(height: DesignTokens.spaceLg),
                              _buildFAQSection(),
                              const SizedBox(height: DesignTokens.spaceLg),
                              _buildResourcesSection(),
                              const SizedBox(height: DesignTokens.spaceLg),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            ref.watch(createSupportTicketProvider).maybeWhen(
                  loading: () =>
                      const LoadingOverlay(message: 'Submitting ticket…'),
                  orElse: () => const SizedBox.shrink(),
                ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      color: AppColors.background,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(DesignTokens.spaceMd,
              DesignTokens.spaceMd, DesignTokens.spaceMd, DesignTokens.spaceSm),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.gray100,
                ),
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => context.pop(),
                    borderRadius: BorderRadius.circular(24),
                    child: const Center(
                      child: Icon(Icons.arrow_back_ios_new,
                          size: 20, color: AppColors.textPrimary),
                    ),
                  ),
                ),
              ),
              const Expanded(
                child: Text(
                  'Help & Support',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              const SizedBox(width: 48),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      height: 56,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: const [
          BoxShadow(
              color: AppColors.shadow, blurRadius: 4, offset: Offset(0, 1)),
        ],
      ),
      child: TextField(
        controller: _searchController,
        onChanged: (value) => setState(() => _searchQuery = value),
        decoration: InputDecoration(
          hintText: 'Search for help…',
          hintStyle:
              const TextStyle(color: AppColors.textDisabled, fontSize: 15),
          prefixIcon: const Icon(Icons.manage_search,
              color: AppColors.primary, size: 24),
          suffixIcon: _searchQuery.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.close,
                      color: AppColors.gray400, size: 18),
                  onPressed: () {
                    _searchController.clear();
                    setState(() => _searchQuery = '');
                  },
                )
              : null,
          border: InputBorder.none,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            borderSide: const BorderSide(color: AppColors.primary, width: 2),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            borderSide: BorderSide.none,
          ),
        ),
        style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w500,
            color: AppColors.textPrimary),
      ),
    );
  }

  Widget _buildContactForm() {
    return PremiumCard(
      margin: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.support_agent, color: AppColors.primary, size: 20),
              SizedBox(width: DesignTokens.spaceSm),
              Text(
                'Contact Support',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          const Text(
            'Submit a support ticket and our team will get back to you.',
            style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          // Category dropdown
          const Text(
            'CATEGORY',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 6),
          Container(
            decoration: BoxDecoration(
              color: AppColors.gray50,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.gray200),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _selectedCategory,
                isExpanded: true,
                icon: const Icon(Icons.expand_more,
                    color: AppColors.textDisabled),
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                borderRadius: BorderRadius.circular(12),
                style:
                    const TextStyle(fontSize: 15, color: AppColors.textPrimary),
                items: const [
                  DropdownMenuItem(
                      value: 'general', child: Text('General Inquiry')),
                  DropdownMenuItem(
                      value: 'technical', child: Text('Technical Issue')),
                  DropdownMenuItem(
                      value: 'billing', child: Text('Billing Question')),
                  DropdownMenuItem(
                      value: 'account', child: Text('Account Problem')),
                ],
                onChanged: (value) =>
                    setState(() => _selectedCategory = value ?? 'general'),
              ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildFormField(
            label: 'SUBJECT',
            controller: _subjectController,
            hint: 'Brief summary of your issue',
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildFormField(
            label: 'DESCRIPTION',
            controller: _bodyController,
            hint: 'Describe your issue in detail…',
            maxLines: 4,
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _submitTicket,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Submit Ticket',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFormField({
    required String label,
    required TextEditingController controller,
    String? hint,
    int maxLines = 1,
  }) {
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
        TextField(
          controller: controller,
          maxLines: maxLines,
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(color: AppColors.textDisabled),
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

  Widget _buildFAQSection() {
    final faqs = _filteredFaqs;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Frequently Asked Questions',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        if (faqs.isEmpty)
          const Padding(
            padding: EdgeInsets.all(DesignTokens.spaceLg),
            child: Center(
              child: Text(
                'No results found. Try a different search.',
                style: TextStyle(color: AppColors.textSecondary),
              ),
            ),
          )
        else
          for (int i = 0; i < faqs.length; i++) ...[
            _FAQExpansionTile(item: faqs[i]),
            if (i < faqs.length - 1)
              const SizedBox(height: DesignTokens.spaceSm),
          ],
      ],
    );
  }

  Widget _buildResourcesSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: DesignTokens.spaceMd),
          child: Text(
            'Resources',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: AppColors.textPrimary,
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        _buildResourceItem(
          icon: Icons.menu_book,
          iconColor: AppColors.textSecondary,
          iconBgColor: AppColors.gray100,
          title: 'User Guide',
          subtitle: 'Quick tips for the SmartCura app',
          onTap: () => _showUserGuide(context),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        _buildResourceItem(
          icon: Icons.bug_report,
          iconColor: AppColors.error,
          iconBgColor: AppColors.errorContainer,
          title: 'Report a Bug',
          subtitle: 'Let us know if something is broken',
          onTap: () {
            // Pre-fill the contact form with the "technical" category.
            setState(() {
              _selectedCategory = 'technical';
              _subjectController.text = 'Bug Report';
            });
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Please describe the bug below and submit.'),
                backgroundColor: AppColors.info,
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _buildResourceItem({
    required IconData icon,
    required Color iconColor,
    required Color iconBgColor,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return PremiumCard(
      margin: EdgeInsets.zero,
      onTap: () {
        HapticFeedback.lightImpact();
        onTap();
      },
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration:
                BoxDecoration(color: iconBgColor, shape: BoxShape.circle),
            child: Icon(icon, color: iconColor, size: 20),
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
                    fontWeight: FontWeight.bold,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                      fontSize: 12, color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, color: AppColors.gray400, size: 20),
        ],
      ),
    );
  }
}

/// Custom FAQ Expansion Tile with icon
class _FAQExpansionTile extends StatefulWidget {
  final _FaqItem item;

  const _FAQExpansionTile({required this.item});

  @override
  State<_FAQExpansionTile> createState() => _FAQExpansionTileState();
}

class _FAQExpansionTileState extends State<_FAQExpansionTile>
    with SingleTickerProviderStateMixin {
  bool _isExpanded = false;
  late AnimationController _controller;
  late Animation<double> _expandAnimation;
  late Animation<double> _iconRotation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    _expandAnimation =
        CurvedAnimation(parent: _controller, curve: Curves.easeInOut);
    _iconRotation = Tween<double>(begin: 0.0, end: 0.5).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(
          color: _isExpanded
              ? AppColors.primary.withOpacity(0.2)
              : AppColors.gray200,
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.shadow.withOpacity(_isExpanded ? 0.08 : 0.04),
            blurRadius: _isExpanded ? 12 : 8,
            offset: Offset(0, _isExpanded ? 4 : 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            setState(() {
              _isExpanded = !_isExpanded;
              if (_isExpanded) {
                _controller.forward();
              } else {
                _controller.reverse();
              }
            });
          },
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          child: Padding(
            padding: const EdgeInsets.all(DesignTokens.spaceMd),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.1),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(widget.item.icon,
                          color: AppColors.primary, size: 18),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        widget.item.question,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: _isExpanded
                              ? AppColors.primary
                              : AppColors.textPrimary,
                        ),
                      ),
                    ),
                    RotationTransition(
                      turns: _iconRotation,
                      child: Icon(
                        Icons.expand_more,
                        color:
                            _isExpanded ? AppColors.primary : AppColors.gray400,
                        size: 24,
                      ),
                    ),
                  ],
                ),
                SizeTransition(
                  sizeFactor: _expandAnimation,
                  child: FadeTransition(
                    opacity: _expandAnimation,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 12, left: 44),
                      child: Text(
                        widget.item.answer,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                          height: 1.5,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
