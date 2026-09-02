/// Money helpers — sen is the canonical integer unit; RM is display-only.
library;

String formatSen(int sen) => 'RM ${(sen / 100).toStringAsFixed(2)}';
