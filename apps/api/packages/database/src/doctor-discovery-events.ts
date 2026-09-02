export const DOCTOR_REVIEW_CHANGED_EVENT_TYPE = 'doctor_review.changed.v1';
export const DOCTOR_REVIEW_CHANGED_EVENT_VERSION = 1;

export const DOCTOR_REVIEW_TAGS = [
  'good_listener', 'on_time', 'clear_explanation', 'professional', 'helpful',
] as const;
export type DoctorReviewTag = typeof DOCTOR_REVIEW_TAGS[number];
