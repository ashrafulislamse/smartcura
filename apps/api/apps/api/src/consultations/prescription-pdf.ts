import type { PrescriptionPdfWork } from '@smartcura/database/consultations';

/**
 * Renders a minimal but valid PDF 1.4 for a signed prescription.
 *
 * The FYP demo uses in-database bytea storage so no object-storage pipeline is
 * required. This generator produces a real PDF without extra dependencies; it is
 * intentionally simple (single page, Helvetica text, no images) to keep the
 * backend lightweight while still delivering a downloadable document.
 */
export function renderPrescriptionPdf(work: PrescriptionPdfWork): Buffer {
  const lines = buildPdfLines(work);
  const stream = lines
    .map((line, index) => `BT /F1 11 Tf 50 ${720 - index * 18} Td (${escapePdfString(line)}) Tj ET`)
    .join('\n');
  const streamBytes = Buffer.from(stream, 'binary');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj',
    `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream\nendobj`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += object + '\n';
  }

  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'binary');
}

function buildPdfLines(work: PrescriptionPdfWork): string[] {
  const lines: string[] = [];
  lines.push('SmartCura Medical Prescription');
  lines.push('');
  lines.push(`Prescription ID: ${work.prescriptionId}`);
  lines.push(`Status: ${work.status}`);
  lines.push(`Signed at: ${work.signedAt.toISOString()}`);
  if (work.expiresAt !== null) {
    lines.push(`Expires at: ${work.expiresAt.toISOString()}`);
  }
  lines.push('');
  if (work.diagnosis !== null && work.diagnosis.length > 0) {
    lines.push(`Diagnosis: ${work.diagnosis}`);
    lines.push('');
  }
  lines.push('Medications:');
  if (work.items.length === 0) {
    lines.push('  No medications recorded.');
  } else {
    for (const item of work.items) {
      const medication = item.medicationText ?? item.medicationReference ?? 'Unknown medication';
      const dose = `${item.doseValue} ${item.doseUnit}`;
      const route = item.routeCode;
      const frequency = item.frequencyText ?? item.frequencyCode ?? 'as directed';
      const duration = `${item.durationDays} day(s)`;
      lines.push(`  - ${medication} | ${dose} | ${route} | ${frequency} | ${duration}`);
      if (item.patientInstructions !== null && item.patientInstructions.length > 0) {
        lines.push(`    Instructions: ${item.patientInstructions}`);
      }
    }
  }
  lines.push('');
  lines.push('This document is generated from electronic health records for demonstration purposes.');
  lines.push('Not a legally valid prescription without the required regulatory and clinical validation.');
  return lines;
}

function escapePdfString(value: string): string {
  return value
    .replace(/[\\()]/g, '\\$&')
    .replace(/[^\x00-\x7F]/g, '?');
}
