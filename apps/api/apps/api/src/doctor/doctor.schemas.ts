import { z } from 'zod';

/**
 * Schemas for the doctor dashboard and analytics endpoints.
 *
 * These endpoints are GET-only with no query parameters, so the schemas are minimal.
 * They exist for shape consistency with the rest of the API and to declare the
 * appointment-status vocabulary in one place rather than retyping it.
 *
 * The status vocabulary is derived from `APPOINTMENT_STATUS_VOCABULARY` in the
 * repository rather than retyped — retyping is how `waiting_requester` became
 * `waiting_on_requester` (see AGENTS.md conventions). The analytics response is
 * intentionally not validated by a strict output schema because it is built
 * field-by-field with optional omission, and a strict schema would either reject
 * the omitted-field shape or force every field to be present, defeating the
 * best-effort design.
 */
export {
  APPOINTMENT_STATUS_VOCABULARY,
  type AppointmentStatusCount,
} from './doctor-dashboard.repository.js';

/**
 * The number of upcoming appointments to return on the dashboard. Fixed at 5 so the
 * dashboard payload stays small and predictable; a doctor who needs the full list
 * uses the appointment collection endpoint.
 */
export const UPCOMING_APPOINTMENT_LIMIT = 5;
