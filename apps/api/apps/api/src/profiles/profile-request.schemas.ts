import { z } from 'zod';

const displayName = z.string().trim().min(1).max(120);
const phoneE164 = z.string().regex(/^\+[1-9][0-9]{7,14}$/).nullable();
const preferredLocale = z.string().trim().min(2).max(35).refine(isLocale);
const timezone = z.string().trim().min(1).max(64).refine(isTimezone);

export const updateMyProfileSchema = z.object({
  display_name: displayName.optional(),
  phone_e164: phoneE164.optional(),
  preferred_locale: preferredLocale.optional(),
  timezone: timezone.optional(),
  complete_onboarding: z.literal(true).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

export type UpdateMyProfileRequest = z.infer<typeof updateMyProfileSchema>;

const hexSha256 = z.string().regex(/^[0-9a-fA-F]{64}$/);

export const uploadAvatarSchema = z.object({
  bytes_base64: z.string().min(1).refine((value) => {
    const buffer = Buffer.from(value, 'base64');
    return buffer.toString('base64') === value && buffer.length > 0 && buffer.length <= 2 * 1024 * 1024;
  }, { message: 'Avatar must be a valid base64-encoded image no larger than 2 MB' }),
  media_type: z.string().regex(/^image\/[a-z0-9+\-.]+$/i),
  declared_sha256: hexSha256.optional(),
}).strict();

export type UploadAvatarRequest = z.infer<typeof uploadAvatarSchema>;

function isLocale(value: string): boolean {
  try {
    new Intl.Locale(value);
    return true;
  } catch {
    return false;
  }
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
