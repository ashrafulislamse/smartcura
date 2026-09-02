/// Money formatting helpers.
///
/// Money is carried as **integer sen** (1 MYR = 100 sen) on the wire and in
/// every contract type — the backend never sends a formatted string. Display
/// formatting happens here, in exactly one place, so a card can never disagree
/// with the booking bar about a price. See AGENTS.md "Money".
class MoneyFormatter {
  MoneyFormatter._();

  /// Formats an integer-sen amount plus an ISO-4217 currency code into a
  /// human-readable string, e.g. `5000` sen of `MYR` → `RM 50.00`.
  static String format(int sen, String currency) {
    final value = (sen / 100).toStringAsFixed(2);
    return switch (currency) {
      'MYR' => 'RM $value',
      'USD' => '\$$value',
      'SGD' => 'S\$ $value',
      'EUR' => '€$value',
      'GBP' => '£$value',
      _ => '$currency $value',
    };
  }

  /// Formats only the numeric portion (no currency symbol), e.g. `5000` →
  /// `50.00`. Useful when the currency is shown separately.
  static String amount(int sen) => (sen / 100).toStringAsFixed(2);

  /// Formats an integer-sen amount without trailing `.00` when the amount is a
  /// whole currency unit. Keeps the same currency-symbol rules as [format].
  static String formatCompact(int sen, String currency) {
    final hasSen = sen % 100 != 0;
    final value =
        hasSen ? (sen / 100).toStringAsFixed(2) : (sen ~/ 100).toString();
    return switch (currency) {
      'MYR' => 'RM $value',
      'USD' => '\$$value',
      'SGD' => 'S\$ $value',
      'EUR' => '€$value',
      'GBP' => '£$value',
      _ => '$currency $value',
    };
  }
}
