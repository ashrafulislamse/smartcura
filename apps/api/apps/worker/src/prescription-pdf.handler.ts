import type { PrescriptionRepository, PrescriptionPdfWork } from '@smartcura/database/consultations';
import type { ObjectStorageProvider } from '@smartcura/storage';

export class PrescriptionPdfHandler {
  constructor(
    private readonly prescriptions: PrescriptionRepository,
    private readonly storage: ObjectStorageProvider,
  ) {}

  async handle(prescriptionId: string): Promise<boolean> {
    const work = await this.prescriptions.loadPdfWork(prescriptionId);
    if (work === undefined) return true;
    const key = `prescriptions/${prescriptionId}/signed.pdf`;
    const bytes = renderPrescriptionPdf(work);
    await this.storage.put({ key, contentType: 'application/pdf', bytes });
    const result = await this.prescriptions.completePdf({
      prescriptionId, objectKey: key, bytes, now: new Date(),
    });
    return result !== 'not_found';
  }
}

export function renderPrescriptionPdf(work: PrescriptionPdfWork): Uint8Array {
  const lines = [
    'SmartCura Signed Prescription',
    `Prescription: ${work.prescriptionId}`,
    `Signed: ${work.signedAt.toISOString()}`,
    ...(work.expiresAt === null ? [] : [`Expires: ${work.expiresAt.toISOString()}`]),
    ...work.items.map((item) =>
      `${item.position}. ${item.medicationReference ?? item.medicationText ?? 'Medication'} ` +
      `${item.doseValue} ${item.doseUnit}; ${item.routeCode}; ` +
      `${item.frequencyCode ?? item.frequencyText}; ${item.durationDays} days`,
    ),
  ];
  const stream = lines.map((line, index) =>
    `BT /F1 10 Tf 50 ${780 - index * 16} Td (${escapePdf(line)}) Tj ET`,
  ).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(pdf, 'utf8'));
}

function escapePdf(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}
