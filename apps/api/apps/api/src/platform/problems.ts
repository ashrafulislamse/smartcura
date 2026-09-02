import { createUuidV7, getCorrelationId } from '@smartcura/observability';
import type { ZodIssue } from 'zod';
import {
  ProblemDetailsException,
  type FieldViolation,
  type ProblemDetails,
} from './problem-details.filter.js';

export function correlationId(): string {
  return getCorrelationId() ?? createUuidV7();
}

export function problem(
  status: number,
  code: string,
  title: string,
  requestCorrelationId: string = correlationId(),
): ProblemDetailsException {
  const details: ProblemDetails = {
    type: `https://smartcura.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    correlation_id: requestCorrelationId,
  };
  return new ProblemDetailsException(details);
}

export function sessionInvalid(): ProblemDetailsException {
  return problem(401, 'APP_SESSION_INVALID', 'Application session is invalid');
}

export function validationFailed(): ProblemDetailsException {
  return problem(422, 'VALIDATION_FAILED', 'Request validation failed');
}

/**
 * Same as [validationFailed] but carries the Zod issues as field-level violations
 * so the client can show *which* field failed and *why*, instead of a generic
 * "Request validation failed".
 *
 * Zod issues carry a `path` (e.g. `['readings', 0, 'value']`), a `code`
 * (e.g. `too_small`, `custom`), and a `message`. We join the path into a
 * dot-indexed string (`readings.0.value`) and map the Zod issue code to a
 * short stable label so the `FieldViolation.code` is always a compact token.
 */
export function validationFailedWithDetails(
  issues: ZodIssue[],
): ProblemDetailsException {
  const violations: FieldViolation[] = issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    code: zodCodeToLabel(issue.code),
    message: issue.message,
  }));
  const details: ProblemDetails = {
    type: 'https://smartcura.example/problems/validation-failed',
    title: 'Request validation failed',
    status: 422,
    code: 'VALIDATION_FAILED',
    correlation_id: correlationId(),
    errors: violations,
  };
  return new ProblemDetailsException(details);
}

function zodCodeToLabel(code: string): string {
  // Map the common Zod issue codes to compact labels. Unknown codes pass
  // through as-is — they are already short enough.
  switch (code) {
    case 'invalid_type':
      return 'TYPE_MISMATCH';
    case 'invalid_enum_value':
      return 'INVALID_ENUM';
    case 'too_small':
      return 'VALUE_TOO_SMALL';
    case 'too_big':
      return 'VALUE_TOO_BIG';
    case 'invalid_string':
      return 'INVALID_FORMAT';
    case 'custom':
      return 'CONSTRAINT_FAILED';
    default:
      return code.toUpperCase();
  }
}
