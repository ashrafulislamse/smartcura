/**
 * Doctor clinical templates surface: the current doctor's own authored templates.
 *
 * SCOPE IS DERIVED FROM THE CALLER'S MEMBERSHIP, not from a parameter. The backend returns
 * only templates authored by the active doctor membership, so a page must not attempt to
 * widen or narrow that with a parameter of its own.
 *
 * DELETE IS A SOFT ARCHIVE. The backend marks the template `archived` rather than removing
 * the row, so a consultation that already referenced it keeps resolving it. `expected_version`
 * travels as a query parameter on DELETE (the OpenAPI path declares it there, not in the body),
 * and as a body field on PUT, matching the contract exactly — retyping the location is how a
 * correct version number ends up ignored and the write earns a spurious 409.
 */

import type {
  ClinicalTemplate,
  ClinicalTemplateCreateRequest,
  ClinicalTemplateList,
  ClinicalTemplateStatus,
  ClinicalTemplateUpdateRequest,
  UnknownEnumValue,
} from '@/types/contracts';
import { apiRequest } from './client';

export type { ClinicalTemplateStatus };

type KnownTemplateStatus = Exclude<ClinicalTemplateStatus, UnknownEnumValue>;

/**
 * The template statuses that are still usable for new consultations. Named once so a page
 * filtering the library cannot drift from the vocabulary — a `Record<string, string>` is how
 * an invented key compiles silently and a count reads zero permanently.
 */
export const CLINICAL_TEMPLATE_STATUS_STYLE: Record<KnownTemplateStatus, string> = {
  active: 'bg-green-50 text-green-700 border-green-100',
  archived: 'bg-slate-100 text-slate-600 border-slate-200',
};

export interface ListDoctorTemplatesOptions {
  readonly search?: string;
  readonly status?: ClinicalTemplateStatus;
  readonly cursor?: string;
  /** Server-bounded; requesting more is refused rather than silently clamped. */
  readonly pageSize?: number;
  readonly signal?: AbortSignal;
}

export function listDoctorTemplates(
  options: ListDoctorTemplatesOptions = {},
): Promise<ClinicalTemplateList> {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.status) params.set('status', options.status);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  return apiRequest<ClinicalTemplateList>({
    method: 'GET',
    path: `/doctor/templates${suffix}`,
    signal: options.signal,
  });
}

export function getDoctorTemplate(
  templateId: string,
  signal?: AbortSignal,
): Promise<ClinicalTemplate> {
  return apiRequest<ClinicalTemplate>({
    method: 'GET',
    path: `/doctor/templates/${encodeURIComponent(templateId)}`,
    signal,
  });
}

export function createDoctorTemplate(
  body: ClinicalTemplateCreateRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ClinicalTemplate> {
  return apiRequest<ClinicalTemplate>({
    method: 'POST',
    path: '/doctor/templates',
    body,
    csrf: true,
    idempotencyKey,
    signal,
  });
}

export function updateDoctorTemplate(
  templateId: string,
  body: ClinicalTemplateUpdateRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ClinicalTemplate> {
  return apiRequest<ClinicalTemplate>({
    method: 'PUT',
    path: `/doctor/templates/${encodeURIComponent(templateId)}`,
    body,
    csrf: true,
    idempotencyKey,
    signal,
  });
}

/**
 * Archives a template. `expected_version` is a query parameter on DELETE per the contract,
 * not a body field, so it is encoded into the path suffix rather than passed as `body`.
 */
export function archiveDoctorTemplate(
  templateId: string,
  expectedVersion: number,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ClinicalTemplate> {
  const params = new URLSearchParams();
  params.set('expected_version', String(expectedVersion));
  return apiRequest<ClinicalTemplate>({
    method: 'DELETE',
    path: `/doctor/templates/${encodeURIComponent(templateId)}?${params.toString()}`,
    csrf: true,
    idempotencyKey,
    signal,
  });
}

/**
 * Presentation-layer helpers for the free-form `content` JSON.
 *
 * The contract types `content` as `Record<string, unknown>`, so a template carries no
 * dedicated `type` column — the kind of template (SOAP note, prescription, etc.) lives inside
 * `content.type`, and the structured body lives inside `content.sections[].fields[]`. These
 * helpers read that shape defensively so a malformed or hand-authored template never throws in
 * the render path: every accessor narrows with `typeof`/`Array.isArray` and falls back to a
 * neutral default. Named once here so the list page and the editor page share one vocabulary
 * and cannot drift — a `Record<string, string>` is how an invented key compiles silently.
 *
 * `UiTone` mirrors the `Badge`/`StatCard` tone unions without importing the UI layer, keeping
 * the api module free of component dependencies; the structural match is enforced at the call
 * site where the value is passed to `<Badge tone={...}>`.
 */
export type UiTone = 'blue' | 'indigo' | 'amber' | 'orange' | 'red' | 'green' | 'purple' | 'slate' | 'teal';

export const TEMPLATE_TYPES = [
  'note',
  'soap',
  'prescription',
  'consultation',
  'referral',
  'custom',
] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const TEMPLATE_TYPE_LABEL: Record<TemplateType, string> = {
  note: 'Clinical note',
  soap: 'SOAP note',
  prescription: 'Prescription',
  consultation: 'Consultation',
  referral: 'Referral',
  custom: 'Custom',
};

export const TEMPLATE_TYPE_TONE: Record<TemplateType, UiTone> = {
  note: 'blue',
  soap: 'teal',
  prescription: 'purple',
  consultation: 'indigo',
  referral: 'orange',
  custom: 'slate',
};

export const TEMPLATE_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'datetime',
  'time',
  'select',
  'multiselect',
  'checkbox',
  'radio',
  'scale',
  'measurement',
  'signature',
  'image',
  'file',
] as const;
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<TemplateFieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  datetime: 'Date & time',
  time: 'Time',
  select: 'Dropdown',
  multiselect: 'Multi-select',
  checkbox: 'Checkbox',
  radio: 'Radio',
  scale: 'Scale',
  measurement: 'Measurement',
  signature: 'Signature',
  image: 'Image',
  file: 'File',
};

export const FIELD_TYPE_TONE: Record<TemplateFieldType, UiTone> = {
  text: 'slate',
  textarea: 'slate',
  number: 'blue',
  date: 'indigo',
  datetime: 'indigo',
  time: 'indigo',
  select: 'teal',
  multiselect: 'teal',
  checkbox: 'green',
  radio: 'green',
  scale: 'amber',
  measurement: 'purple',
  signature: 'orange',
  image: 'orange',
  file: 'orange',
};

export interface TemplateFieldPreview {
  readonly label: string;
  readonly typeLabel: string;
  readonly typeTone: UiTone;
  readonly required: boolean;
}

export interface TemplateSectionPreview {
  readonly title: string;
  readonly fields: ReadonlyArray<TemplateFieldPreview>;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function humaniseLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Reads `content.type` and maps it to a known template kind, defaulting to `note` when the
 * field is absent or holds an unrecognised value. The default is a deliberate choice — a
 * template without a declared type is still a clinical note — not a silent fallback that
 * hides malformed data, because the editor surfaces the raw JSON alongside the preview.
 */
export function deriveTemplateType(content: unknown): TemplateType {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const typeValue = (content as Record<string, unknown>).type;
    if (
      typeof typeValue === 'string' &&
      (TEMPLATE_TYPES as readonly string[]).includes(typeValue)
    ) {
      return typeValue as TemplateType;
    }
  }
  return 'note';
}

/**
 * Parses `content.sections[].fields[]` into a render-ready shape. Each field's `type` is
 * mapped to a known label and tone; an unrecognised type is shown verbatim (humanised) with a
 * neutral tone so a doctor authoring a custom field type still sees it reflected in the
 * preview rather than swallowed by a default.
 */
export function extractTemplateSections(content: unknown): ReadonlyArray<TemplateSectionPreview> {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return [];
  const root = content as Record<string, unknown>;
  const sectionsValue = root.sections;
  if (!Array.isArray(sectionsValue)) return [];
  return sectionsValue.map((rawSection, sectionIndex) => {
    const section =
      rawSection && typeof rawSection === 'object' && !Array.isArray(rawSection)
        ? (rawSection as Record<string, unknown>)
        : {};
    const title = asNonEmptyString(section.title) ?? `Section ${sectionIndex + 1}`;
    const fieldsValue = Array.isArray(section.fields) ? section.fields : [];
    const fields = fieldsValue.map((rawField, fieldIndex) => {
      const field =
        rawField && typeof rawField === 'object' && !Array.isArray(rawField)
          ? (rawField as Record<string, unknown>)
          : {};
      const label =
        asNonEmptyString(field.label) ??
        asNonEmptyString(field.name) ??
        `Field ${fieldIndex + 1}`;
      const rawType = asNonEmptyString(field.type) ?? 'text';
      const typeLabel =
        rawType in FIELD_TYPE_LABEL
          ? FIELD_TYPE_LABEL[rawType as TemplateFieldType]
          : humaniseLabel(rawType);
      const typeTone =
        rawType in FIELD_TYPE_TONE ? FIELD_TYPE_TONE[rawType as TemplateFieldType] : 'slate';
      const required = field.required === true;
      return { label, typeLabel, typeTone, required };
    });
    return { title, fields };
  });
}

/**
 * A one-line summary for a template card: "3 sections · 12 fields". Falls back to a top-level
 * `fields` count, then to "Free-form content" when neither shape is present, so a card never
 * shows a bare zero for a template that is simply not section-based.
 */
export function deriveSectionFieldSummary(content: unknown): string {
  const sections = extractTemplateSections(content);
  if (sections.length === 0) {
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      const fields = (content as Record<string, unknown>).fields;
      if (Array.isArray(fields)) {
        return `${fields.length} field${fields.length === 1 ? '' : 's'}`;
      }
    }
    return 'Free-form content';
  }
  const totalFields = sections.reduce((sum, section) => sum + section.fields.length, 0);
  const sectionWord = `${sections.length} section${sections.length === 1 ? '' : 's'}`;
  const fieldWord = `${totalFields} field${totalFields === 1 ? '' : 's'}`;
  return `${sectionWord} · ${fieldWord}`;
}

/**
 * Patches `type` into a content JSON string, returning the re-serialised string. Used by the
 * editor's type select so choosing a kind writes into the same `content` object the JSON
 * textarea owns, keeping a single source of truth. When the current string is empty or
 * unparseable, a fresh `{"type": ...}` object is produced rather than discarding the choice.
 */
export function applyTemplateTypeToContentJson(contentJson: string, type: TemplateType): string {
  let parsed: Record<string, unknown> = {};
  const trimmed = contentJson.trim();
  if (trimmed) {
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      // Fall through to a fresh object — the editor still shows the invalid string in the
      // textarea and the preview warns about it, so nothing is lost silently.
    }
  }
  parsed.type = type;
  return JSON.stringify(parsed, null, 2);
}
