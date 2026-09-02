import { z } from 'zod';
import { DOCTOR_REVIEW_TAGS } from '@smartcura/database';

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const specialty = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const language = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

export const searchDoctorsSchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  specialty: specialty.optional(),
  language: language.optional(),
  max_fee_sen: z.coerce.number().int().min(0).max(10_000_000).optional(),
  min_rating: z.coerce.number().min(1).max(5).optional(),
  accepts_new_patients: booleanQuery.optional(),
  sort: z.enum(['soonest', 'rating', 'fee']).default('soonest'),
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const listDoctorReviewsSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const saveDoctorReviewSchema = z.object({
  expected_version: z.number().int().min(0),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(1000).nullable().default(null),
  tags: z.array(z.enum(DOCTOR_REVIEW_TAGS)).max(5).default([]),
}).strict().refine((value) => new Set(value.tags).size === value.tags.length, {
  message: 'Review tags must be unique',
});

export const doctorPathSchema = z.object({ membershipId: uuidV7 }).strict();
export const reviewAppointmentPathSchema = z.object({ appointmentId: uuidV7 }).strict();
export type SearchDoctorsQuery = z.infer<typeof searchDoctorsSchema>;
export type ListDoctorReviewsQuery = z.infer<typeof listDoctorReviewsSchema>;
