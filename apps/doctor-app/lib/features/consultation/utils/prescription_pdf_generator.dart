import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart' show Color;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:qr_flutter/qr_flutter.dart';

/// Structured prescription data captured BEFORE signing.
///
/// On read-back from the API, [Prescription.items] is `List<String>` (opaque
/// item ids), so the structured drug/dose/frequency data is only available in
/// the draft UI state at sign time. This value object freezes that snapshot so
/// the PDF generator does not depend on a re-fetched, opaque prescription.
class PrescriptionPdfData {
  const PrescriptionPdfData({
    required this.prescriptionId,
    required this.organizationName,
    required this.patientName,
    required this.patientId,
    required this.doctorName,
    required this.doctorSpecialty,
    required this.doctorLicenseNumber,
    required this.consultationId,
    required this.diagnosis,
    required this.issuedAt,
    required this.expiresAt,
    required this.items,
    required this.verificationUrl,
  });

  /// The signed prescription id (used in the QR link and footer).
  final String prescriptionId;

  /// Organization / clinic name for the header. Empty string if unknown.
  final String organizationName;

  /// Patient display name.
  final String patientName;

  /// Patient profile id (shortened for display).
  final String patientId;

  /// Doctor display name.
  final String doctorName;

  /// Doctor specialty, or empty string if unset.
  final String doctorSpecialty;

  /// Doctor license number, or empty string if unset.
  final String doctorLicenseNumber;

  /// Consultation id this prescription belongs to.
  final String consultationId;

  /// Free-text diagnosis recorded for context.
  final String diagnosis;

  /// ISO-8601 issued-at instant (the sign time).
  final String issuedAt;

  /// ISO-8601 expiry instant, or empty string if none.
  final String expiresAt;

  /// Structured medication lines.
  final List<PrescriptionPdfItem> items;

  /// The portal URL the QR code encodes
  /// (`https://portal.smartcura.app/prescriptions/{id}`).
  final String verificationUrl;
}

/// A single medication line in the PDF, frozen from the draft form.
class PrescriptionPdfItem {
  const PrescriptionPdfItem({
    required this.drugName,
    required this.dose,
    required this.route,
    required this.frequency,
    required this.durationDays,
    required this.instructions,
  });

  final String drugName;
  final String dose; // e.g. "500 mg"
  final String route; // e.g. "Oral"
  final String frequency; // e.g. "Twice daily (BID)"
  final int durationDays;
  final String instructions; // may be empty
}

/// Brand colors mirrored from `AppColors` so the PDF matches the app identity.
class _PdfBrand {
  static const PdfColor primary = PdfColor.fromInt(0xFF0F766E); // Teal-700
  static const PdfColor primaryDark = PdfColor.fromInt(0xFF115E59); // Teal-800
  static const PdfColor primaryContainer =
      PdfColor.fromInt(0xFFCCFBF1); // Teal-100
  static const PdfColor gray900 = PdfColor.fromInt(0xFF111827);
  static const PdfColor gray600 = PdfColor.fromInt(0xFF4B5563);
  static const PdfColor gray500 = PdfColor.fromInt(0xFF6B7280);
  static const PdfColor gray200 = PdfColor.fromInt(0xFFE5E7EB);
  static const PdfColor gray50 = PdfColor.fromInt(0xFFF9FAFB);
  static const PdfColor white = PdfColor.fromInt(0xFFFFFFFF);
}

/// Renders a [PrescriptionPdfData] snapshot to a single-page A4 PDF and
/// returns the document bytes.
///
/// The QR code is rendered to a PNG via [QrPainter] (from `qr_flutter`) and
/// embedded as a [PdfImage]. The QR encodes [PrescriptionPdfData.verificationUrl],
/// which points at the patient-facing portal prescription record so a pharmacist
/// or patient can verify the prescription by scanning.
///
/// This function is pure (no I/O besides the in-memory QR render) and safe to
/// call from any isolate. It never re-fetches the prescription, so it works
/// even after signing has turned `items` into opaque ids server-side.
Future<Uint8List> generatePrescriptionPdf(PrescriptionPdfData data) async {
  final qrPng = await _renderQrPng(data.verificationUrl);

  final doc = pw.Document(
    theme: pw.ThemeData.withFont(
      base: pw.Font.helvetica(),
      bold: pw.Font.helveticaBold(),
      italic: pw.Font.helveticaOblique(),
      boldItalic: pw.Font.helveticaBoldOblique(),
    ),
  );

  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(40),
      build: (context) => _buildContent(data, qrPng),
    ),
  );

  return doc.save();
}

/// Render the QR code for [data] to PNG bytes using `qr_flutter`'s [QrPainter].
/// Returns `null` if the QR cannot be encoded (the caller renders a fallback).
Future<Uint8List?> _renderQrPng(String data) async {
  try {
    final painter = QrPainter(
      data: data,
      version: QrVersions.auto,
      gapless: true,
      eyeStyle: const QrEyeStyle(
        eyeShape: QrEyeShape.square,
        color: Color(0xFF111827),
      ),
      dataModuleStyle: const QrDataModuleStyle(
        dataModuleShape: QrDataModuleShape.square,
        color: Color(0xFF111827),
      ),
    );
    final byteData = await painter.toImageData(240, format: ui.ImageByteFormat.png);
    if (byteData == null) return null;
    return byteData.buffer.asUint8List();
  } catch (_) {
    // QR encoding failure is non-fatal: the PDF still carries the URL as text.
    return null;
  }
}

pw.Widget _buildContent(
  PrescriptionPdfData data,
  Uint8List? qrPng,
) {
  final children = <pw.Widget>[
    _buildHeader(data),
    pw.SizedBox(height: 24),
    _buildPatientDoctorRow(data),
    pw.SizedBox(height: 20),
    _buildMetaRow(data),
    pw.SizedBox(height: 20),
    _buildDiagnosis(data),
    pw.SizedBox(height: 20),
    _buildMedicationsTable(data),
    pw.SizedBox(height: 28),
    _buildSignatureBlock(data),
    pw.SizedBox(height: 24),
    _buildVerificationSection(data, qrPng),
    pw.Spacer(),
    _buildFooter(data),
  ];

  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: children,
  );
}

pw.Widget _buildHeader(PrescriptionPdfData data) {
  return pw.Container(
    padding: const pw.EdgeInsets.symmetric(horizontal: 20, vertical: 16),
    decoration: pw.BoxDecoration(
      color: _PdfBrand.primary,
      borderRadius: pw.BorderRadius.circular(8),
    ),
    child: pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.center,
      children: [
        pw.Container(
          width: 40,
          height: 40,
          decoration: pw.BoxDecoration(
            color: _PdfBrand.white,
            borderRadius: pw.BorderRadius.circular(10),
          ),
          alignment: pw.Alignment.center,
          child: pw.Text(
            'S',
            style: pw.TextStyle(
              font: pw.Font.helveticaBold(),
              fontSize: 22,
              color: _PdfBrand.primary,
            ),
          ),
        ),
        pw.SizedBox(width: 14),
        pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text(
                'SmartCura',
                style: pw.TextStyle(
                  font: pw.Font.helveticaBold(),
                  fontSize: 20,
                  color: _PdfBrand.white,
                ),
              ),
              pw.SizedBox(height: 2),
              pw.Text(
                'Electronic Prescription',
                style: pw.TextStyle(
                  font: pw.Font.helvetica(),
                  fontSize: 12,
                  color: _PdfBrand.primaryContainer,
                ),
              ),
            ],
          ),
        ),
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.end,
          children: [
            pw.Text(
              'Rx #${_shortId(data.prescriptionId)}',
              style: pw.TextStyle(
                font: pw.Font.helveticaBold(),
                fontSize: 12,
                color: _PdfBrand.white,
              ),
            ),
            pw.SizedBox(height: 2),
            pw.Text(
              _formatDateTime(data.issuedAt),
              style: pw.TextStyle(
                font: pw.Font.helvetica(),
                fontSize: 10,
                color: _PdfBrand.primaryContainer,
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

pw.Widget _buildPatientDoctorRow(PrescriptionPdfData data) {
  return pw.Row(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: [
      pw.Expanded(
        child: _buildInfoCard(
          title: 'Patient',
          lines: [
            ('Name', data.patientName),
            ('Patient ID', _shortId(data.patientId)),
          ],
        ),
      ),
      pw.SizedBox(width: 16),
      pw.Expanded(
        child: _buildInfoCard(
          title: 'Prescribed by',
          lines: [
            ('Doctor', data.doctorName),
            if (data.doctorSpecialty.isNotEmpty)
              ('Specialty', data.doctorSpecialty),
            if (data.doctorLicenseNumber.isNotEmpty)
              ('License #', data.doctorLicenseNumber),
          ],
        ),
      ),
    ],
  );
}

pw.Widget _buildInfoCard({
  required String title,
  required List<(String, String)> lines,
}) {
  return pw.Container(
    padding: const pw.EdgeInsets.all(12),
    decoration: pw.BoxDecoration(
      color: _PdfBrand.gray50,
      border: pw.Border.all(color: _PdfBrand.gray200, width: 0.5),
      borderRadius: pw.BorderRadius.circular(6),
    ),
    child: pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Text(
          title.toUpperCase(),
          style: pw.TextStyle(
            font: pw.Font.helveticaBold(),
            fontSize: 9,
            color: _PdfBrand.primary,
            letterSpacing: 1.2,
          ),
        ),
        pw.SizedBox(height: 8),
        ...lines.map((l) => pw.Padding(
              padding: const pw.EdgeInsets.only(bottom: 4),
              child: _keyValue(l.$1, l.$2),
            )),
      ],
    ),
  );
}

pw.Widget _keyValue(String key, String value) {
  return pw.Row(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: [
      pw.SizedBox(
        width: 70,
        child: pw.Text(
          key,
          style: pw.TextStyle(
            font: pw.Font.helvetica(),
            fontSize: 10,
            color: _PdfBrand.gray500,
          ),
        ),
      ),
      pw.Expanded(
        child: pw.Text(
          value,
          style: pw.TextStyle(
            font: pw.Font.helvetica(),
            fontSize: 10,
            color: _PdfBrand.gray900,
          ),
        ),
      ),
    ],
  );
}

pw.Widget _buildMetaRow(PrescriptionPdfData data) {
  return pw.Container(
    padding: const pw.EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: pw.BoxDecoration(
      color: _PdfBrand.primaryContainer,
      borderRadius: pw.BorderRadius.circular(6),
    ),
    child: pw.Row(
      children: [
        pw.Text(
          'Issued: ',
          style: pw.TextStyle(
            font: pw.Font.helveticaBold(),
            fontSize: 10,
            color: _PdfBrand.primaryDark,
          ),
        ),
        pw.Text(
          _formatDateTime(data.issuedAt),
          style: pw.TextStyle(
            font: pw.Font.helvetica(),
            fontSize: 10,
            color: _PdfBrand.primaryDark,
          ),
        ),
        if (data.expiresAt.isNotEmpty) ...[
          pw.SizedBox(width: 20),
          pw.Text(
            'Valid until: ',
            style: pw.TextStyle(
              font: pw.Font.helveticaBold(),
              fontSize: 10,
              color: _PdfBrand.primaryDark,
            ),
          ),
          pw.Text(
            _formatDateTime(data.expiresAt),
            style: pw.TextStyle(
              font: pw.Font.helvetica(),
              fontSize: 10,
              color: _PdfBrand.primaryDark,
            ),
          ),
        ],
      ],
    ),
  );
}

pw.Widget _buildDiagnosis(PrescriptionPdfData data) {
  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: [
      pw.Text(
        'DIAGNOSIS',
        style: pw.TextStyle(
          font: pw.Font.helveticaBold(),
          fontSize: 10,
          color: _PdfBrand.primary,
          letterSpacing: 1.2,
        ),
      ),
      pw.SizedBox(height: 6),
      pw.Container(
        width: double.infinity,
        padding: const pw.EdgeInsets.all(10),
        decoration: pw.BoxDecoration(
          color: _PdfBrand.gray50,
          border: pw.Border.all(color: _PdfBrand.gray200, width: 0.5),
          borderRadius: pw.BorderRadius.circular(6),
        ),
        child: pw.Text(
          data.diagnosis.isEmpty ? 'Not specified' : data.diagnosis,
          style: pw.TextStyle(
            font: pw.Font.helvetica(),
            fontSize: 11,
            color: _PdfBrand.gray900,
          ),
        ),
      ),
      pw.SizedBox(height: 4),
      pw.Text(
        'For context only — the coded diagnosis is recorded in the clinical note.',
        style: pw.TextStyle(
          font: pw.Font.helveticaOblique(),
          fontSize: 8,
          color: _PdfBrand.gray500,
        ),
      ),
    ],
  );
}

pw.Widget _buildMedicationsTable(PrescriptionPdfData data) {
  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: [
      pw.Text(
        'MEDICATIONS (${data.items.length})',
        style: pw.TextStyle(
          font: pw.Font.helveticaBold(),
          fontSize: 10,
          color: _PdfBrand.primary,
          letterSpacing: 1.2,
        ),
      ),
      pw.SizedBox(height: 8),
      _buildItemsTable(data.items),
    ],
  );
}

pw.Widget _buildItemsTable(List<PrescriptionPdfItem> items) {
  if (items.isEmpty) {
    return pw.Container(
      padding: const pw.EdgeInsets.all(12),
      decoration: pw.BoxDecoration(
        color: _PdfBrand.gray50,
        borderRadius: pw.BorderRadius.circular(6),
      ),
      child: pw.Text(
        'No medications recorded.',
        style: pw.TextStyle(
          font: pw.Font.helveticaOblique(),
          fontSize: 10,
          color: _PdfBrand.gray500,
        ),
      ),
    );
  }

  return pw.Table(
    border: pw.TableBorder.all(color: _PdfBrand.gray200, width: 0.5),
    tableWidth: pw.TableWidth.max,
    columnWidths: const {
      0: pw.FixedColumnWidth(28),
      1: pw.FlexColumnWidth(3),
      2: pw.FlexColumnWidth(2),
      3: pw.FlexColumnWidth(2),
      4: pw.FlexColumnWidth(3),
      5: pw.FixedColumnWidth(48),
    },
    children: [
      pw.TableRow(
        decoration: const pw.BoxDecoration(color: _PdfBrand.primaryContainer),
        children: [
          _tableHeaderCell('#'),
          _tableHeaderCell('Drug'),
          _tableHeaderCell('Dose'),
          _tableHeaderCell('Route'),
          _tableHeaderCell('Frequency'),
          _tableHeaderCell('Days'),
        ],
      ),
      ...items.asMap().entries.map((entry) {
        final i = entry.key;
        final item = entry.value;
        return pw.TableRow(
          decoration: pw.BoxDecoration(
            color: i.isEven ? _PdfBrand.white : _PdfBrand.gray50,
          ),
          children: [
            _tableBodyCell('${i + 1}', align: pw.Alignment.center),
            _tableBodyCell(item.drugName, bold: true),
            _tableBodyCell(item.dose),
            _tableBodyCell(item.route),
            _tableBodyCell(item.frequency),
            _tableBodyCell(
              item.durationDays > 0 ? '${item.durationDays}' : '—',
              align: pw.Alignment.center,
            ),
          ],
        );
      }),
      // Instructions are rendered as a full-width sub-row per item so long
      // patient instructions do not blow out the table column widths.
      ...items.asMap().entries.where((e) => e.value.instructions.isNotEmpty).map(
            (entry) => pw.TableRow(
              decoration: pw.BoxDecoration(
                color: entry.key.isEven ? _PdfBrand.white : _PdfBrand.gray50,
              ),
              children: [
                pw.Container(),
                _tableInstructionCell(entry.value.instructions),
                pw.Container(),
                pw.Container(),
                pw.Container(),
                pw.Container(),
              ],
            ),
          ),
    ],
  );
}

pw.Widget _tableHeaderCell(String text) {
  return pw.Padding(
    padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 6),
    child: pw.Text(
      text,
      style: pw.TextStyle(
        font: pw.Font.helveticaBold(),
        fontSize: 9,
        color: _PdfBrand.primaryDark,
      ),
    ),
  );
}

pw.Widget _tableBodyCell(
  String text, {
  pw.Alignment align = pw.Alignment.centerLeft,
  bool bold = false,
}) {
  return pw.Padding(
    padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 5),
    child: pw.Align(
      alignment: align,
      child: pw.Text(
        text,
        style: pw.TextStyle(
          font: bold ? pw.Font.helveticaBold() : pw.Font.helvetica(),
          fontSize: 9,
          color: _PdfBrand.gray900,
        ),
      ),
    ),
  );
}

/// Renders the patient-instructions line spanning columns 1..5 by drawing a
/// wide padded cell in the "Drug" column slot. Because [pw.Table] does not
/// support colSpan, the empty sibling cells keep the row aligned and the
/// instruction text is given the widest flex column to live in.
pw.Widget _tableInstructionCell(String instructions) {
  return pw.Padding(
    padding: const pw.EdgeInsets.fromLTRB(6, 0, 6, 5),
    child: pw.Text(
      'Instructions: $instructions',
      style: pw.TextStyle(
        font: pw.Font.helveticaOblique(),
        fontSize: 8,
        color: _PdfBrand.gray600,
      ),
    ),
  );
}

pw.Widget _buildSignatureBlock(PrescriptionPdfData data) {
  return pw.Row(
    crossAxisAlignment: pw.CrossAxisAlignment.end,
    children: [
      pw.Expanded(
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            // Signature line.
            pw.Container(
              height: 1,
              color: _PdfBrand.gray500,
              margin: const pw.EdgeInsets.only(top: 32),
            ),
            pw.SizedBox(height: 4),
            pw.Text(
              'Digitally signed by ${data.doctorName}',
              style: pw.TextStyle(
                font: pw.Font.helveticaBold(),
                fontSize: 10,
                color: _PdfBrand.gray900,
              ),
            ),
            pw.SizedBox(height: 2),
            pw.Text(
              'Signature authenticated via step-up verification on ${_formatDateTime(data.issuedAt)}.',
              style: pw.TextStyle(
                font: pw.Font.helveticaOblique(),
                fontSize: 8,
                color: _PdfBrand.gray500,
              ),
            ),
          ],
        ),
      ),
    ],
  );
}

pw.Widget _buildVerificationSection(
  PrescriptionPdfData data,
  Uint8List? qrPng,
) {
  // Build the image provider from the QR PNG bytes. `MemoryImage` decodes the
  // PNG against the page document at layout time; if the bytes are missing or
  // undecodable we fall back to a placeholder box.
  pw.ImageProvider? qrProvider;
  if (qrPng != null) {
    try {
      qrProvider = pw.MemoryImage(qrPng);
    } catch (_) {
      qrProvider = null;
    }
  }
  return pw.Container(
    padding: const pw.EdgeInsets.all(12),
    decoration: pw.BoxDecoration(
      color: _PdfBrand.gray50,
      border: pw.Border.all(color: _PdfBrand.gray200, width: 0.5),
      borderRadius: pw.BorderRadius.circular(6),
    ),
    child: pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        if (qrProvider != null)
          pw.ClipRRect(
            horizontalRadius: 4,
            verticalRadius: 4,
            child: pw.Image(qrProvider, width: 90, height: 90),
          )
        else
          pw.Container(
            width: 90,
            height: 90,
            decoration: pw.BoxDecoration(
              border: pw.Border.all(color: _PdfBrand.gray200),
              borderRadius: pw.BorderRadius.circular(4),
            ),
            alignment: pw.Alignment.center,
            child: pw.Text(
              'QR\nunavailable',
              textAlign: pw.TextAlign.center,
              style: pw.TextStyle(
                font: pw.Font.helvetica(),
                fontSize: 8,
                color: _PdfBrand.gray500,
              ),
            ),
          ),
        pw.SizedBox(width: 16),
        pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text(
                'VERIFICATION',
                style: pw.TextStyle(
                  font: pw.Font.helveticaBold(),
                  fontSize: 9,
                  color: _PdfBrand.primary,
                  letterSpacing: 1.2,
                ),
              ),
              pw.SizedBox(height: 6),
              pw.Text(
                'Scan the QR code to verify this prescription on the SmartCura '
                'patient portal.',
                style: pw.TextStyle(
                  font: pw.Font.helvetica(),
                  fontSize: 9,
                  color: _PdfBrand.gray600,
                ),
              ),
              pw.SizedBox(height: 6),
              pw.Text(
                data.verificationUrl,
                style: pw.TextStyle(
                  font: pw.Font.helveticaOblique(),
                  fontSize: 8,
                  color: _PdfBrand.primary,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

pw.Widget _buildFooter(PrescriptionPdfData data) {
  return pw.Container(
    padding: const pw.EdgeInsets.symmetric(vertical: 8),
    decoration: const pw.BoxDecoration(
      border: pw.Border(
        top: pw.BorderSide(color: _PdfBrand.gray200, width: 0.5),
      ),
    ),
    child: pw.Center(
      child: pw.Text(
        'This e-prescription was generated by SmartCura Doctor. '
        'Rx ${_shortId(data.prescriptionId)} · '
        'Consultation ${_shortId(data.consultationId)}',
        style: pw.TextStyle(
          font: pw.Font.helvetica(),
          fontSize: 8,
          color: _PdfBrand.gray500,
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Helpers

/// Shorten a uuid-ish id to its last 8 characters, uppercased, for display.
String _shortId(String id) =>
    id.length <= 8 ? id.toUpperCase() : id.substring(id.length - 8).toUpperCase();

/// Best-effort ISO-8601 -> human-readable "15 Aug 2026, 14:30 UTC".
/// Falls back to the raw string if parsing fails so the PDF is never blank.
String _formatDateTime(String iso) {
  if (iso.isEmpty) return '—';
  try {
    final dt = DateTime.parse(iso);
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    final h = dt.toUtc().hour.toString().padLeft(2, '0');
    final m = dt.toUtc().minute.toString().padLeft(2, '0');
    return '${dt.toUtc().day} ${months[dt.toUtc().month - 1]} '
        '${dt.toUtc().year}, $h:$m UTC';
  } catch (_) {
    return iso;
  }
}
