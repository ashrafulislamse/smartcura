import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/models/contract_decoders.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/providers/providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// SharedPreferences keys for the persisted bank account.
///
/// No GET /drivers/me/bank-accounts endpoint exists, so the driver can only
/// POST to register a bank account. We persist the `bank_account_id` and
/// `account_last4` returned from registration locally for future withdrawals.
const _kBankAccountId = 'driver_bank_account_id';
const _kBankAccountLast4 = 'driver_bank_account_last4';

/// Minimum withdrawal amount in sen (RM 1.00 = 100 sen).
const _minWithdrawalSen = 100;

/// Money helpers — sen is the canonical integer unit; RM is display-only.
String formatSen(int sen) => 'RM ${(sen / 100).toStringAsFixed(2)}';
int rmToSen(double rm) => (rm * 100).round();

class WithdrawalScreen extends ConsumerStatefulWidget {
  const WithdrawalScreen({super.key});

  @override
  ConsumerState<WithdrawalScreen> createState() => _WithdrawalScreenState();
}

class _WithdrawalScreenState extends ConsumerState<WithdrawalScreen> {
  // ---- Bank account registration form controllers ----
  final _bankCodeController = TextEditingController();
  final _accountNumberController = TextEditingController();

  // ---- Withdrawal amount controller ----
  final _amountController = TextEditingController();

  // ---- Persisted bank account (loaded from shared_preferences) ----
  String? _savedBankAccountId;
  String? _savedAccountLast4;
  bool _prefsLoaded = false;

  // ---- Mutation state ----
  bool _registering = false;
  bool _withdrawing = false;

  // ---- Success state ----
  WithdrawalRequested? _result;
  int _requestedAmountSen = 0;

  @override
  void initState() {
    super.initState();
    _loadSavedBankAccount();
  }

  @override
  void dispose() {
    _bankCodeController.dispose();
    _accountNumberController.dispose();
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _loadSavedBankAccount() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _savedBankAccountId = prefs.getString(_kBankAccountId);
      _savedAccountLast4 = prefs.getString(_kBankAccountLast4);
      _prefsLoaded = true;
    });
  }

  Future<void> _registerBankAccount() async {
    final bankCode = _bankCodeController.text.trim();
    final accountNumber = _accountNumberController.text.trim();

    if (bankCode.isEmpty || accountNumber.isEmpty) {
      AppSnackbar.warning(context, 'Please fill in all bank details.');
      return;
    }

    setState(() => _registering = true);
    try {
      final api = ref.read(apiClientProvider);
      final body = await api.post(
        ApiEndpoints.driversMeBankAccounts,
        body: <String, dynamic>{
          'bank_code': bankCode,
          'account_number': accountNumber,
        },
      );
      final registered = decodeBankAccountRegistered(body);

      // Persist for future withdrawals (no GET endpoint exists).
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kBankAccountId, registered.bankAccountId);
      await prefs.setString(_kBankAccountLast4, registered.accountLast4);

      if (!mounted) return;
      setState(() {
        _savedBankAccountId = registered.bankAccountId;
        _savedAccountLast4 = registered.accountLast4;
        _registering = false;
      });
      AppSnackbar.success(context, 'Bank account registered successfully.');
    } catch (e) {
      if (!mounted) return;
      setState(() => _registering = false);
      final msg = e is ApiError ? e.displayMessage : 'Failed to register bank account.';
      AppSnackbar.error(context, msg);
    }
  }

  Future<void> _requestWithdrawal() async {
    final raw = _amountController.text.trim();
    if (raw.isEmpty) {
      AppSnackbar.warning(context, 'Please enter an amount.');
      return;
    }

    final rm = double.tryParse(raw);
    if (rm == null || rm <= 0) {
      AppSnackbar.warning(context, 'Please enter a valid amount.');
      return;
    }

    final amountSen = rmToSen(rm);
    if (amountSen < _minWithdrawalSen) {
      AppSnackbar.warning(context, 'Minimum withdrawal is RM 1.00.');
      return;
    }

    final earnings = ref.read(driverEarningsProvider).value;
    if (earnings != null && amountSen > earnings.balanceSen) {
      AppSnackbar.error(context, 'Amount exceeds available balance.');
      return;
    }

    final bankAccountId = _savedBankAccountId;
    if (bankAccountId == null) {
      AppSnackbar.error(context, 'No bank account on file. Please register one.');
      return;
    }

    setState(() => _withdrawing = true);
    try {
      final api = ref.read(apiClientProvider);
      final body = await api.post(
        ApiEndpoints.driversMeWithdrawals,
        body: <String, dynamic>{
          'bank_account_id': bankAccountId,
          'amount_sen': amountSen,
        },
      );
      final result = decodeWithdrawalRequested(body);
      if (!mounted) return;
      setState(() {
        _result = result;
        _requestedAmountSen = amountSen;
        _withdrawing = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _withdrawing = false);
      final msg = e is ApiError ? e.displayMessage : 'Withdrawal request failed.';
      // Handle known withdrawal error cases with friendlier messages.
      if (e is ApiError) {
        final detail = e.detail?.toLowerCase() ?? '';
        if (detail.contains('insufficient')) {
          AppSnackbar.error(context, 'Insufficient balance for this withdrawal.');
        } else if (detail.contains('in flight') || detail.contains('in-flight')) {
          AppSnackbar.error(context, 'You already have a withdrawal being processed.');
        } else if (detail.contains('bank account') && detail.contains('not found')) {
          AppSnackbar.error(context, 'Bank account not found. Please re-register.');
        } else {
          AppSnackbar.error(context, msg);
        }
      } else {
        AppSnackbar.error(context, msg);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Success state takes over the entire screen.
    if (_result != null) {
      return _SuccessView(
        result: _result!,
        requestedAmountSen: _requestedAmountSen,
      );
    }

    final earningsAsync = ref.watch(driverEarningsProvider);
    final balanceSen = earningsAsync.value?.balanceSen ?? 0;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Withdraw Funds'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ---- Balance card ----
            _BalanceCard(balanceSen: balanceSen),
            const SizedBox(height: DesignTokens.spaceLg),

            // ---- Bank account section ----
            if (!_prefsLoaded)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(DesignTokens.spaceLg),
                  child: CircularProgressIndicator(color: AppColors.primary),
                ),
              )
            else if (_savedBankAccountId == null)
              _BankRegistrationForm(
                bankCodeController: _bankCodeController,
                accountNumberController: _accountNumberController,
                onRegister: _registerBankAccount,
                loading: _registering,
              )
            else
              _SavedBankAccount(
                last4: _savedAccountLast4 ?? '----',
                onWithdraw: _requestWithdrawal,
                amountController: _amountController,
                balanceSen: balanceSen,
                withdrawing: _withdrawing,
              ),

            const SizedBox(height: DesignTokens.spaceXxl),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Balance card — gradient with available balance
// ---------------------------------------------------------------------------

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.balanceSen});
  final int balanceSen;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: const BoxDecoration(
        gradient: AppColors.primaryGradient,
        borderRadius: BorderRadius.all(Radius.circular(DesignTokens.radiusXl)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Available Balance',
                  style: TextStyle(
                    color: AppColors.white.withValues(alpha: 0.7),
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceXs),
                Text(
                  formatSen(balanceSen),
                  style: const TextStyle(
                    color: AppColors.white,
                    fontSize: 32,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceXs),
                Text(
                  'Min withdrawal: ${formatSen(_minWithdrawalSen)}',
                  style: TextStyle(
                    color: AppColors.white.withValues(alpha: 0.6),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.white.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            ),
            child: const Icon(Icons.account_balance_wallet_rounded,
                color: AppColors.white, size: 28),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Bank account registration form — shown when no saved account exists
// ---------------------------------------------------------------------------

class _BankRegistrationForm extends StatelessWidget {
  const _BankRegistrationForm({
    required this.bankCodeController,
    required this.accountNumberController,
    required this.onRegister,
    required this.loading,
  });

  final TextEditingController bankCodeController;
  final TextEditingController accountNumberController;
  final VoidCallback onRegister;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.account_balance_rounded,
                  color: AppColors.primary, size: DesignTokens.iconMd),
              SizedBox(width: DesignTokens.spaceSm),
              Text(
                'Register Bank Account',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceXs),
          const Text(
            'Add a bank account to withdraw your earnings. '
            'Only the last 4 digits are stored.',
            style: TextStyle(
              fontSize: 13,
              color: AppColors.textSecondary,
              height: 1.4,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          CustomTextField(
            label: 'Bank Code',
            hint: 'e.g. MBB',
            controller: bankCodeController,
            prefixIcon: Icons.code_rounded,
            keyboardType: TextInputType.text,
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Bank code is required';
              if (!RegExp(r'^[A-Z0-9]{3,32}$').hasMatch(v.trim())) {
                return '3-32 alphanumeric characters (A-Z, 0-9)';
              }
              return null;
            },
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          CustomTextField(
            label: 'Account Number',
            hint: 'e.g. 1234567890',
            controller: accountNumberController,
            prefixIcon: Icons.numbers_rounded,
            keyboardType: TextInputType.number,
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Account number is required';
              if (!RegExp(r'^[0-9]{6,20}$').hasMatch(v.trim())) {
                return '6-20 digits';
              }
              return null;
            },
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          SizedBox(
            width: double.infinity,
            child: PrimaryButton(
              text: 'Register Account',
              icon: Icons.check_rounded,
              onPressed: loading ? null : onRegister,
              isLoading: loading,
              height: DesignTokens.buttonHeightMd,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Saved bank account + withdrawal amount form
// ---------------------------------------------------------------------------

class _SavedBankAccount extends StatelessWidget {
  const _SavedBankAccount({
    required this.last4,
    required this.onWithdraw,
    required this.amountController,
    required this.balanceSen,
    required this.withdrawing,
  });

  final String last4;
  final VoidCallback onWithdraw;
  final TextEditingController amountController;
  final int balanceSen;
  final bool withdrawing;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ---- Saved account card ----
        PremiumCard(
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                ),
                child: const Icon(Icons.account_balance_rounded,
                    color: AppColors.primary, size: DesignTokens.iconMd),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Withdrawal Account',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '**** $last4',
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const StatusBadge(
                text: 'Active',
                tone: StatusTone.success,
                small: true,
              ),
            ],
          ),
        ),
        const SizedBox(height: DesignTokens.spaceLg),

        // ---- Withdrawal amount input ----
        PremiumCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Withdrawal Amount',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              TextField(
                controller: amountController,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
                decoration: InputDecoration(
                  hintText: '0.00',
                  hintStyle: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textDisabled,
                  ),
                  prefixText: 'RM  ',
                  prefixStyle: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                  filled: true,
                  fillColor: AppColors.gray50,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                    borderSide: const BorderSide(color: AppColors.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                    borderSide: const BorderSide(color: AppColors.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                    borderSide: const BorderSide(
                        color: AppColors.primary, width: 1.5),
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              // Quick-fill button
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () {
                    amountController.text =
                        (balanceSen / 100).toStringAsFixed(2);
                  },
                  child: const Text(
                    'Withdraw All',
                    style: TextStyle(
                      fontSize: 13,
                      color: AppColors.primary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              SizedBox(
                width: double.infinity,
                child: PrimaryButton(
                  text: 'Request Withdrawal',
                  icon: Icons.send_rounded,
                  onPressed: withdrawing ? null : onWithdraw,
                  isLoading: withdrawing,
                  height: DesignTokens.buttonHeightLg,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Success view — shown after a successful withdrawal request
// ---------------------------------------------------------------------------

class _SuccessView extends StatelessWidget {
  const _SuccessView({required this.result, required this.requestedAmountSen});
  final WithdrawalRequested result;
  final int requestedAmountSen;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceLg),
          child: Column(
            children: [
              const Spacer(),
              Container(
                width: 110,
                height: 110,
                decoration: const BoxDecoration(
                  color: AppColors.successContainer,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.check_circle_rounded,
                    color: AppColors.success, size: 64),
              ),
              const SizedBox(height: DesignTokens.spaceLg),
              const Text(
                'Withdrawal Requested!',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              Text(
                'Your withdrawal of ${formatSen(requestedAmountSen)} is being processed.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 15,
                  color: AppColors.textSecondary,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceXl),
              PremiumCard(
                child: Column(
                  children: [
                    _SuccessRow(
                        label: 'Reference',
                        value: _shortId(result.withdrawalId)),
                    _SuccessRow(
                        label: 'Status',
                        value: result.status,
                        isStatus: true),
                    _SuccessRow(
                        label: 'Remaining Balance',
                        value: formatSen(result.remainingSen)),
                  ],
                ),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: PrimaryButton(
                  text: 'Done',
                  icon: Icons.check_rounded,
                  onPressed: () => context.go('/earnings'),
                  height: DesignTokens.buttonHeightLg,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceLg),
            ],
          ),
        ),
      ),
    );
  }

  String _shortId(String id) =>
      id.length > 12 ? '${id.substring(0, 12)}...' : id;
}

// ---------------------------------------------------------------------------
// Success row — label + value pair
// ---------------------------------------------------------------------------

class _SuccessRow extends StatelessWidget {
  const _SuccessRow({
    required this.label,
    required this.value,
    this.isStatus = false,
  });
  final String label;
  final String value;
  final bool isStatus;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          isStatus
              ? StatusBadge(text: value, tone: StatusTone.warning, small: true)
              : Text(
                  value,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
        ],
      ),
    );
  }
}
