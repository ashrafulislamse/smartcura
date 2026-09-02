import { defineConfig } from 'drizzle-kit';

/**
 * Every schema module must be listed here.
 *
 * When this pointed at `src/schema.ts` alone, drizzle-kit could not see the
 * appointment, IoT, verification-review or profile-detail tables and reported
 * "no schema changes" while the declared model and the database disagreed — a
 * false all-clear is worse than a missing check, because it is trusted.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema.ts',
    './src/schema-appointments.ts',
    './src/schema-iot.ts',
    './src/schema-profile-details.ts',
    './src/schema-verification.ts',
    './src/schema-doctor-discovery.ts',
    './src/schema-consultations.ts',
    './src/schema-stage11.ts',
  ],
  out: './drizzle',
  strict: true,
  verbose: true,
});
