import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import {
  CareAccessRepository,
  DoctorDiscoveryRepository,
  FoundationReadinessRepository,
  MembershipRepository,
  OutboxRepository,
  PostgresConnection,
  PrivateFileRepository,
  ProfileRepository,
  PushTokenCipher,
  SessionRepository,
  VerificationRepository,
  WorkstreamFRepository,
} from '@smartcura/database';
// Imported through subpath exports rather than the package root because
// `packages/database/src/index.ts` is being edited concurrently. HANDOFF-0011.md
// lists the root re-exports to add; these imports become
// `from '@smartcura/database'` once they exist.
import { DoctorDetailRepository } from '@smartcura/database/doctor-detail-repository';
import { PatientProfileRepository } from '@smartcura/database/patient-profile-repository';
import { AiRepository } from '@smartcura/database/ai';
import { PharmacyRepository } from '@smartcura/database/pharmacy';
import { DispatchRepository } from '@smartcura/database/dispatch';
import {
  ConsultationRepository,
  MessagingRepository,
  NotificationRepository,
  PrescriptionRepository,
} from '@smartcura/database/consultations';
import {
  AppointmentRepository,
  AvailabilityRepository,
  AvailabilityScheduleRepository,
} from '@smartcura/database/appointments';
// WP-07a device and reading repositories, reached through the temporary `iot`
// subpath for the same reason as the imports above. HANDOFF-0014.md lists the root
// re-exports that will replace it.
import {
  DeviceRepository,
  FirmwareRepository,
  VitalReadingRepository,
} from '@smartcura/database/iot';
import {
  createObjectStorageProvider,
  type ObjectStorageProvider,
} from '@smartcura/storage';
import {
  DeterministicLocalIdentityTokenVerifier,
  FirebaseJwksIdentityTokenVerifier,
  GooglePublicKeySource,
  type IdentityTokenVerifier,
  type VerifiedIdentity,
} from '@smartcura/identity';
import {
  CareAssignmentsController,
  ConsentGrantsController,
  OrganizationCareAssignmentsController,
} from './care-access/care-access.controller.js';
import { CareAccessService } from './care-access/care-access.service.js';
import {
  AiArtifactsController,
  AiConversationsController,
  AiGenerationsController,
} from './ai/ai.controller.js';
import { AiService } from './ai/ai.service.js';
import {
  DeliveryRatingsController,
  DispatchAssignmentsController,
  DispatchOffersController,
  DriverEarningsController,
  InventoryController,
  MedicationsController,
  PharmacyOrdersController,
} from './logistics/logistics.controller.js';
import { EmergencyRepository } from '@smartcura/database/emergency';
import { FinanceRepository } from '@smartcura/database/finance';
import { Stage11Repository } from '@smartcura/database/stage11';
import { MetricsRepository } from '@smartcura/database';
import { ProcurementRepository } from '@smartcura/database/procurement';
import { ProcurementController, ProcurementService } from './logistics/procurement.controller.js';
import { FinanceController, SupportController, AdministrationController } from './finance/finance.controller.js';
import { FinanceService } from './finance/finance.service.js';
import { Stage11AdministrationController } from './administration/stage11.controller.js';
import { Stage11Service } from './administration/stage11.service.js';
import { MetricsService } from './administration/metrics.service.js';
import { EmergencyEventsController, BreakGlassController, EmergencyUnitsController } from './emergency/emergency.controller.js';
import { EmergencyService } from './emergency/emergency.service.js';
import { LogisticsService } from './logistics/logistics.service.js';
import {
  AppointmentConsultationController,
  ClinicalNotesController,
  ConsultationsController,
  ConversationsController,
  DoctorInboxController,
  DoctorNotesController,
  DoctorPrescriptionsController,
  NotificationsController,
  PrescriptionsController,
} from './consultations/clinical-care.controller.js';
import { ClinicalCareService } from './consultations/clinical-care.service.js';
import { LiveKitTokenService } from './consultations/livekit-token.service.js';
import { ChatGateway } from './consultations/chat.gateway.js';
import type { ApiConfig } from './config.js';
import {
  AppointmentsController,
  OrganizationAppointmentsController,
} from './appointments/appointments.controller.js';
import { AppointmentsService } from './appointments/appointments.service.js';
import { AvailabilityController } from './appointments/availability.controller.js';
import { AvailabilityService } from './appointments/availability.service.js';
import {
  AppointmentDoctorReviewController,
  DoctorDiscoveryController,
} from './doctor-discovery/doctor-discovery.controller.js';
import { DoctorDiscoveryService } from './doctor-discovery/doctor-discovery.service.js';
import { DevicesController } from './iot/devices.controller.js';
import { DevicesService } from './iot/devices.service.js';
import { FirmwareController } from './iot/firmware.controller.js';
import { FirmwareService } from './iot/firmware.service.js';
import {
  DeviceVitalReadingsController,
  HealthAlertsController,
  OwnVitalReadingsController,
  PatientVitalReadingsController,
} from './iot/readings.controller.js';
import { ReadingsService } from './iot/readings.service.js';
import { MembershipsController } from './memberships/memberships.controller.js';
import { MembershipsService } from './memberships/memberships.service.js';
import { OperationsController } from './operations/operations.controller.js';
import { OperationsService } from './operations/operations.service.js';
import { CorrelationMiddleware } from './platform/correlation.middleware.js';
import {
  PermissionGuard,
  RequestIntegrityGuard,
  SessionAuthenticationGuard,
  SessionAuthorizationService,
} from './platform/request-authorization.js';
import { RateLimitGuard } from './platform/rate-limit.guard.js';
import { DoctorDetailsController } from './profile-details/doctor-details.controller.js';
import { DoctorDetailsService } from './profile-details/doctor-details.service.js';
import { ProfileDetailsController } from './profile-details/profile-details.controller.js';
import { ProfileDetailsService } from './profile-details/profile-details.service.js';
import { ProfilesController } from './profiles/profiles.controller.js';
import { PatientSelfController } from './profiles/patient-self.controller.js';
import { PatientSelfService } from './profiles/patient-self.service.js';
import { ProfilesService } from './profiles/profiles.service.js';
import { SessionsController } from './sessions/sessions.controller.js';
import { SessionsService } from './sessions/sessions.service.js';
import { API_CONFIG, IDENTITY_TOKEN_VERIFIER, OBJECT_STORAGE } from './tokens.js';
import { PrivateFilesService } from './verification/private-files.service.js';
import {
  VerificationController,
  VerificationReviewController,
} from './verification/verification.controller.js';
import { VerificationService } from './verification/verification.service.js';
import { WorkstreamFController } from './workstream-f/workstream-f.controller.js';
import { WorkstreamFService } from './workstream-f/workstream-f.service.js';
import { ClinicalTemplateRepository } from '@smartcura/database/clinical-templates';
import { DoctorController } from './doctor/doctor.controller.js';
import { DoctorDashboardRepository } from './doctor/doctor-dashboard.repository.js';
import { DoctorService } from './doctor/doctor.service.js';
import { DoctorDevicesController } from './doctor/doctor-devices.controller.js';
import { DoctorDevicesService } from './doctor/doctor-devices.service.js';
import { DoctorEarningsController } from './doctor/doctor-earnings.controller.js';
import { DoctorEarningsService } from './doctor/doctor-earnings.service.js';
import { DoctorTemplatesController } from './doctor/doctor-templates.controller.js';
import { DoctorTemplatesService } from './doctor/doctor-templates.service.js';
import { DoctorAiController } from './doctor/doctor-ai.controller.js';
import { DoctorAiService } from './doctor/doctor-ai.service.js';

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }

  static forRoot(config: ApiConfig): DynamicModule {
    const database = new PostgresConnection(
      config.databaseUrl,
      config.databaseReadinessTimeoutMs,
      'smartcura-api',
    );

    return {
      module: AppModule,
      imports: [createThrottlerModule(config)],
      controllers: [
        OperationsController,
        SessionsController,
        ProfilesController,
        PatientSelfController,
        MembershipsController,
        ProfileDetailsController,
        DoctorDetailsController,
        VerificationController,
        VerificationReviewController,
        ConsentGrantsController,
        CareAssignmentsController,
        OrganizationCareAssignmentsController,
        DoctorDiscoveryController,
        AppointmentDoctorReviewController,
        AvailabilityController,
        AppointmentsController,
        OrganizationAppointmentsController,
        DevicesController,
        FirmwareController,
        DeviceVitalReadingsController,
        OwnVitalReadingsController,
        PatientVitalReadingsController,
        HealthAlertsController,
        AppointmentConsultationController,
        ConsultationsController,
        ClinicalNotesController,
        ConversationsController,
        PrescriptionsController,
        NotificationsController,
        AiConversationsController,
        AiArtifactsController,
        AiGenerationsController,
        MedicationsController,
        InventoryController,
        PharmacyOrdersController,
        DispatchOffersController,
        DispatchAssignmentsController,
        DriverEarningsController,
        DeliveryRatingsController,
        EmergencyEventsController,
        BreakGlassController,
        EmergencyUnitsController,
        FinanceController,
        SupportController,
        AdministrationController,
        Stage11AdministrationController,
        ProcurementController,
        WorkstreamFController,
        DoctorController,
        DoctorNotesController,
        DoctorPrescriptionsController,
        DoctorInboxController,
        DoctorDevicesController,
        DoctorEarningsController,
        DoctorTemplatesController,
        DoctorAiController,
      ],
      providers: [
        { provide: API_CONFIG, useValue: config },
        { provide: IDENTITY_TOKEN_VERIFIER, useValue: createIdentityVerifier(config) },
        { provide: OBJECT_STORAGE, useValue: createObjectStorage(config) },
        { provide: PostgresConnection, useValue: database },
        {
          provide: FoundationReadinessRepository,
          useFactory: (connection: PostgresConnection) => new FoundationReadinessRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: MembershipRepository,
          useFactory: (connection: PostgresConnection) => new MembershipRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: ProfileRepository,
          useFactory: (connection: PostgresConnection) => new ProfileRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: SessionRepository,
          useFactory: (connection: PostgresConnection) => new SessionRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: VerificationRepository,
          useFactory: (connection: PostgresConnection) => new VerificationRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: PrivateFileRepository,
          useFactory: (connection: PostgresConnection) => new PrivateFileRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: DoctorDiscoveryRepository,
          useFactory: (connection: PostgresConnection) => new DoctorDiscoveryRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: CareAccessRepository,
          useFactory: (connection: PostgresConnection) => new CareAccessRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: PatientProfileRepository,
          useFactory: (connection: PostgresConnection) => new PatientProfileRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: DoctorDetailRepository,
          useFactory: (connection: PostgresConnection) => new DoctorDetailRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: AvailabilityRepository,
          useFactory: (connection: PostgresConnection) => new AvailabilityRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: AvailabilityScheduleRepository,
          useFactory: (connection: PostgresConnection) =>
            new AvailabilityScheduleRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: AppointmentRepository,
          useFactory: (connection: PostgresConnection) => new AppointmentRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: AiRepository,
          useFactory: (connection: PostgresConnection) => new AiRepository(connection, config.ai.provider),
          inject: [PostgresConnection],
        },
        {
          provide: ConsultationRepository,
          useFactory: (connection: PostgresConnection) => new ConsultationRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: MessagingRepository,
          useFactory: (connection: PostgresConnection) => new MessagingRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: PrescriptionRepository,
          useFactory: (connection: PostgresConnection) => new PrescriptionRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: NotificationRepository,
          useFactory: (connection: PostgresConnection) => new NotificationRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: DeviceRepository,
          useFactory: (connection: PostgresConnection) => new DeviceRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: VitalReadingRepository,
          useFactory: (connection: PostgresConnection) => new VitalReadingRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: FirmwareRepository,
          useFactory: (connection: PostgresConnection) => new FirmwareRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: FirmwareService,
          useFactory: (
            firmware: FirmwareRepository,
            authorization: SessionAuthorizationService,
            storage: ObjectStorageProvider,
            apiConfig: ApiConfig,
          ) => new FirmwareService(firmware, authorization, storage, apiConfig),
          inject: [FirmwareRepository, SessionAuthorizationService, OBJECT_STORAGE, API_CONFIG],
        },
        CorrelationMiddleware,
        OperationsService,
        SessionAuthorizationService,
        MembershipsService,
        ProfilesService,
        ProfileDetailsService,
        DoctorDetailsService,
        VerificationService,
        WorkstreamFService,
        {
          provide: WorkstreamFRepository,
          useFactory: (connection: PostgresConnection) => new WorkstreamFRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: PrivateFilesService,
          useFactory: (
            files: PrivateFileRepository,
            authorization: SessionAuthorizationService,
            storage: ObjectStorageProvider,
            apiConfig: ApiConfig,
          ) => new PrivateFilesService(files, authorization, storage, apiConfig),
          inject: [PrivateFileRepository, SessionAuthorizationService, OBJECT_STORAGE, API_CONFIG],
        },
        CareAccessService,
        {
          provide: PharmacyRepository,
          useFactory: (connection: PostgresConnection) => new PharmacyRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: DispatchRepository,
          useFactory: (connection: PostgresConnection) => new DispatchRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: LogisticsService,
          useFactory: (
            pharmacy: PharmacyRepository,
            dispatch: DispatchRepository,
          ) => new LogisticsService(pharmacy, dispatch),
          inject: [PharmacyRepository, DispatchRepository],
        },
        {
          provide: ProcurementRepository,
          useFactory: (connection: PostgresConnection) => new ProcurementRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: ProcurementService,
          useFactory: (procurement: ProcurementRepository) => new ProcurementService(procurement),
          inject: [ProcurementRepository],
        },
        {
          provide: FinanceRepository,
          useFactory: (connection: PostgresConnection) => new FinanceRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: FinanceService,
          useFactory: (finance: FinanceRepository) => new FinanceService(finance),
          inject: [FinanceRepository],
        },
        {
          provide: MetricsRepository,
          useFactory: (connection: PostgresConnection) => new MetricsRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: MetricsService,
          useFactory: (metrics: MetricsRepository) => new MetricsService(metrics),
          inject: [MetricsRepository],
        },
        {
          provide: Stage11Repository,
          useFactory: (connection: PostgresConnection) => new Stage11Repository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: OutboxRepository,
          useFactory: (connection: PostgresConnection) => new OutboxRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: Stage11Service,
          useFactory: (stage11: Stage11Repository, outbox: OutboxRepository) =>
            new Stage11Service(stage11, outbox),
          inject: [Stage11Repository, OutboxRepository],
        },
        {
          provide: EmergencyRepository,
          useFactory: (connection: PostgresConnection) => new EmergencyRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: EmergencyService,
          useFactory: (emergency: EmergencyRepository) => new EmergencyService(emergency),
          inject: [EmergencyRepository],
        },
        {
          provide: AiService,
          useFactory: (ai: AiRepository) => new AiService(ai),
          inject: [AiRepository],
        },
        {
          provide: LiveKitTokenService,
          useFactory: (apiConfig: ApiConfig) => new LiveKitTokenService(apiConfig.video),
          inject: [API_CONFIG],
        },
        {
          provide: PushTokenCipher,
          useFactory: (apiConfig: ApiConfig) => new PushTokenCipher(apiConfig.pushTokenEncryptionKey),
          inject: [API_CONFIG],
        },
        {
          provide: ClinicalCareService,
          useFactory: (
            consultations: ConsultationRepository,
            messaging: MessagingRepository,
            prescriptions: PrescriptionRepository,
            notifications: NotificationRepository,
            roomTokens: LiveKitTokenService,
            pushTokens: PushTokenCipher,
          ) => new ClinicalCareService(
            consultations, messaging, prescriptions, notifications, roomTokens, pushTokens,
          ),
          inject: [
            ConsultationRepository, MessagingRepository, PrescriptionRepository,
            NotificationRepository, LiveKitTokenService, PushTokenCipher,
          ],
        },
        ChatGateway,
        DoctorDiscoveryService,
        AvailabilityService,
        AppointmentsService,
        DevicesService,
        ReadingsService,
        SessionsService,
        {
          provide: PatientSelfService,
          useFactory: (
            consultations: ConsultationRepository,
            prescriptions: PrescriptionRepository,
            readings: VitalReadingRepository,
            appointments: AppointmentRepository,
            devices: DeviceRepository,
            authorization: SessionAuthorizationService,
          ) => new PatientSelfService(
            consultations, prescriptions, readings, appointments, devices, authorization,
          ),
          inject: [
            ConsultationRepository, PrescriptionRepository, VitalReadingRepository,
            AppointmentRepository, DeviceRepository, SessionAuthorizationService,
          ],
        },
        {
          provide: DoctorDashboardRepository,
          useFactory: (connection: PostgresConnection) => new DoctorDashboardRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: DoctorService,
          useFactory: (repository: DoctorDashboardRepository) => new DoctorService(repository),
          inject: [DoctorDashboardRepository],
        },
        DoctorDevicesService,
        DoctorEarningsService,
        {
          provide: ClinicalTemplateRepository,
          useFactory: (connection: PostgresConnection) => new ClinicalTemplateRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: DoctorTemplatesService,
          useFactory: (repository: ClinicalTemplateRepository) => new DoctorTemplatesService(repository),
          inject: [ClinicalTemplateRepository],
        },
        {
          provide: DoctorAiService,
          useFactory: (connection: PostgresConnection, apiConfig: ApiConfig) => new DoctorAiService(connection, apiConfig),
          inject: [PostgresConnection, API_CONFIG],
        },
        { provide: APP_GUARD, useClass: SessionAuthenticationGuard },
        { provide: APP_GUARD, useClass: RequestIntegrityGuard },
        // Rate limiting runs after the session is established (so the tracker can
        // key on profile id for authenticated routes) and after CSRF/origin
        // checks (so rejected requests do not consume the caller's budget), but
        // before permission checks (so a flood of forbidden requests is still
        // throttled before it reaches the policy engine).
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    };
  }
}

/**
 * Built once at bootstrap from the already-validated configuration, so a
 * misconfigured deployment fails at startup rather than on the first upload.
 * `createObjectStorageProvider` refuses the in-process memory adapter in
 * production, which is the rule that keeps private identity evidence off a
 * volatile store.
 */
function createObjectStorage(config: ApiConfig): ObjectStorageProvider {
  return createObjectStorageProvider(config.objectStorage, config.environment);
}

function createIdentityVerifier(config: ApiConfig): IdentityTokenVerifier {
  if (config.identity.adapter === 'firebase') {
    // Verifies Firebase ID tokens against Google's published signing keys rather
    // than through the Admin SDK, whose dependency graph carried unresolved
    // high-severity advisories. See the verifier for the revocation tradeoff this
    // accepts.
    return new FirebaseJwksIdentityTokenVerifier(
      new GooglePublicKeySource(),
      config.identity.projectId,
    );
  }
  const identity: VerifiedIdentity = Object.freeze({
    uid: config.identity.uid,
    email: config.identity.email,
    emailVerified: config.identity.emailVerified,
    // Placeholder only. The verifier substitutes the verification time, because a
    // fixed startup timestamp would go stale: step-up requires authentication
    // within the last five minutes, so it became impossible after five minutes of
    // uptime. A real provider issues a token whose `auth_time` reflects the
    // authentication that just happened, which is what this models.
    authTime: new Date(0),
    mfaSatisfied: config.identity.mfaSatisfied,
  });
  const secondary: VerifiedIdentity = Object.freeze({
    uid: config.identity.secondary.uid,
    email: config.identity.secondary.email,
    emailVerified: config.identity.emailVerified,
    authTime: new Date(0),
    mfaSatisfied: config.identity.mfaSatisfied,
  });
  // Two subjects, so two-party rules are verifiable. Break-glass not-self and
  // independent review cannot be exercised at all when one profile owns every
  // membership, and asserting around that gap was hiding real coverage.
  return new DeterministicLocalIdentityTokenVerifier(
    new Map([
      [config.identity.token, identity],
      [config.identity.secondary.token, secondary],
    ]),
    { authenticatedAtVerificationTime: true },
  );
}

/**
 * Rate-limiter module: a global default budget of 100 requests per 60 seconds,
 * keyed by IP for unauthenticated routes and by profile id once the session guard
 * has resolved an identity. Stricter limits are applied per-route with `@Throttle`
 * on authentication and booking routes — see `SessionsController` and
 `OrganizationAppointmentsController.book`.

 * When `SMARTCURA_REDIS_URL` is set the throttler uses the Redis-backed storage so
 * the budget is shared across all API instances. When it is unset (local dev, CI)
 * the throttler falls back to its built-in in-memory storage, so rate limiting
 * still applies within a single process. TTL and limit values are in milliseconds
 * and counts respectively, per the `@nestjs/throttler` v6 contract.
 */
function createThrottlerModule(config: ApiConfig): DynamicModule {
  // The `storage` key is omitted entirely when Redis is unset, rather than set
  // to `undefined`, because `exactOptionalPropertyTypes` rejects a present-but-
  // undefined `storage?: ThrottlerStorage`. Spreading conditionally omits the
  // key, which is the correct shape for the optional property.
  return ThrottlerModule.forRoot({
    throttlers: [{ name: 'default', limit: 100, ttl: 60_000 }],
    ...(config.redis !== undefined
      ? { storage: new ThrottlerStorageRedisService(config.redis.url) }
      : {}),
  });
}
