import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  FoundationReadinessRepository,
  OutboxRepository,
  PostgresConnection,
  PrivateFileRepository,
  PushTokenCipher,
} from '@smartcura/database';
import { AppointmentRepository } from '@smartcura/database/appointments';
import { NotificationRepository, PrescriptionRepository } from '@smartcura/database/consultations';
import { AiRepository } from '@smartcura/database/ai';
import { HealthContextBuilder } from '@smartcura/database/ai';
import { LongitudinalAnalyzer } from '@smartcura/database/ai';
import { RiskScoringEngine, AdvancedAnomalyDetector } from '@smartcura/database/ai';
import { Stage11Repository } from '@smartcura/database/stage11';
import {
  ClamAvMalwareScanner,
  createObjectStorageProvider,
  DeterministicMalwareScanner,
  type MalwareScanner,
  type ObjectStorageProvider,
} from '@smartcura/storage';
import type { MalwareScannerConfig, WorkerConfig } from './config.js';
import { OutboxProcessor } from './outbox.processor.js';
import {
  AppointmentPaymentHandler,
  DeterministicAppointmentPaymentProvider,
} from './appointment-payment.handler.js';
import { PrivateFileScanHandler } from './private-file-scan.handler.js';
import {
  DeterministicPushDeliveryProvider,
  NotificationPushHandler,
  type PushDeliveryProvider,
} from './notification-push.handler.js';
import { FcmPushDeliveryProvider } from './fcm-push.provider.js';
import {
  CloudflareEmailDeliveryProvider,
  DeterministicEmailDeliveryProvider,
  NotificationEmailHandler,
  type EmailDeliveryProvider,
} from './notification-email.handler.js';
import { SmtpEmailDeliveryProvider } from './smtp-email.provider.js';
import { PrescriptionPdfHandler } from './prescription-pdf.handler.js';
import {
  AiGenerationHandler,
  createKnowledgeRetriever,
  createLlmProvider,
} from './ai-generation.handler.js';
import { MALWARE_SCANNER, MQTT_BRIDGE, WORKER_CONFIG, WORKER_OBJECT_STORAGE } from './tokens.js';
import { VitalReadingRepository } from '@smartcura/database/iot';
import { MqttIngestionHandler } from './mqtt-ingestion.handler.js';
import { MqttBridge } from './mqtt-bridge.js';
import { ChatEventPublisher } from './chat-event.publisher.js';

const moduleLogger = new Logger('WorkerModule');

/**
 * Adapter selection for the FYP demo.
 *
 * Payment is intentionally simulated in production. The worker logs a warning at
 * boot so the operator cannot mistake this for a real settlement path. A real
 * gateway can be added later by implementing the provider interface and returning
 * it here.
 *
 * Push has a real FCM adapter (`FcmPushDeliveryProvider`); the deterministic stub
 * remains the default for CI/local dev and as a production fallback when Firebase
 * credentials are not yet provisioned.
 */
function selectPaymentProvider(
  config: WorkerConfig, deterministic: DeterministicAppointmentPaymentProvider,
): DeterministicAppointmentPaymentProvider {
  if (config.environment === 'production' && config.paymentProvider === 'deterministic') {
    moduleLogger.warn(
      'SMARTCURA_PAYMENT_PROVIDER=deterministic in production: appointments will settle without charging money. This is for the FYP demo only.',
    );
  }
  if (config.paymentProvider === 'deterministic') return deterministic;
  throw new Error(
    'No real payment gateway adapter is implemented; SMARTCURA_PAYMENT_PROVIDER=gateway cannot be honoured',
  );
}

function selectPushProvider(
  config: WorkerConfig, deterministic: DeterministicPushDeliveryProvider,
): PushDeliveryProvider {
  if (config.environment === 'production' && config.pushProvider === 'deterministic') {
    moduleLogger.warn(
      'SMARTCURA_PUSH_PROVIDER=deterministic in production: notifications will be recorded as delivered without sending them. This is for the FYP demo only.',
    );
  }
  if (config.pushProvider === 'deterministic') return deterministic;
  if (config.pushProvider === 'fcm') {
    if (config.firebase === undefined) {
      throw new Error(
        'SMARTCURA_PUSH_PROVIDER=fcm requires Firebase service account credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, or FIREBASE_SERVICE_ACCOUNT_PATH) to be set',
      );
    }
    return new FcmPushDeliveryProvider({
      projectId: config.firebase.projectId,
      clientEmail: config.firebase.clientEmail,
      privateKey: config.firebase.privateKey,
    });
  }
  return deterministic;
}

/**
 * Adapter selection for transactional email, mirroring the push channel. The
 * `deterministic` stub logs the email and reports success without sending it; it is
 * allowed in production for the FYP demo with a warning. The `smtp` adapter routes
 * through Hostinger Email SMTP (nodemailer) and requires its credentials; the
 * `cloudflare` adapter routes through the Cloudflare Email Service REST API and
 * requires its credentials. Selecting a real provider without its credentials is a
 * hard failure so a misconfigured production deploy fails to boot rather than
 * silently dropping mail.
 */
function selectEmailProvider(
  config: WorkerConfig, deterministic: DeterministicEmailDeliveryProvider,
): EmailDeliveryProvider {
  if (config.environment === 'production' && config.emailProvider === 'deterministic') {
    moduleLogger.warn(
      'SMARTCURA_EMAIL_PROVIDER=deterministic in production: emails will be recorded as delivered without being sent. This is for the FYP demo only.',
    );
  }
  if (config.emailProvider === 'deterministic') return deterministic;
  if (config.emailProvider === 'smtp') {
    if (config.smtp === undefined) {
      throw new Error(
        'SMARTCURA_EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER, SMTP_PASSWORD (and optionally SMTP_PORT, SMTP_SECURE, SMTP_FROM_EMAIL, SMTP_FROM_NAME) to be set',
      );
    }
    return new SmtpEmailDeliveryProvider({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      user: config.smtp.user,
      password: config.smtp.password,
      fromEmail: config.smtp.fromEmail,
      fromName: config.smtp.fromName,
    });
  }
  if (config.emailProvider === 'cloudflare') {
    if (config.cloudflareEmail === undefined) {
      throw new Error(
        'SMARTCURA_EMAIL_PROVIDER=cloudflare requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_EMAIL_DOMAIN to be set',
      );
    }
    return new CloudflareEmailDeliveryProvider({
      apiToken: config.cloudflareEmail.apiToken,
      accountId: config.cloudflareEmail.accountId,
      fromDomain: config.cloudflareEmail.fromDomain,
      fromName: 'SmartCura',
    });
  }
  return deterministic;
}
import { WorkerRuntime } from './worker.runtime.js';

@Module({})
export class WorkerModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    const database = new PostgresConnection(
      config.databaseUrl,
      config.databaseReadinessTimeoutMs,
      'smartcura-worker',
    );
    return {
      module: WorkerModule,
      providers: [
        { provide: WORKER_CONFIG, useValue: config },
        {
          provide: WORKER_OBJECT_STORAGE,
          useValue: createObjectStorageProvider(config.objectStorage, config.environment),
        },
        { provide: MALWARE_SCANNER, useValue: createScanner(config.malwareScanner) },
        { provide: PostgresConnection, useValue: database },
        {
          provide: FoundationReadinessRepository,
          useFactory: (connection: PostgresConnection) => new FoundationReadinessRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: OutboxRepository,
          useFactory: (connection: PostgresConnection) => new OutboxRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: Stage11Repository,
          useFactory: (connection: PostgresConnection) => new Stage11Repository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: AppointmentRepository,
          useFactory: (connection: PostgresConnection) => new AppointmentRepository(connection),
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
          provide: PrivateFileRepository,
          useFactory: (connection: PostgresConnection) => new PrivateFileRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: PrivateFileScanHandler,
          useFactory: (
            files: PrivateFileRepository,
            storage: ObjectStorageProvider,
            scanner: MalwareScanner,
          ) => new PrivateFileScanHandler(files, storage, scanner),
          inject: [PrivateFileRepository, WORKER_OBJECT_STORAGE, MALWARE_SCANNER],
        },
        DeterministicAppointmentPaymentProvider,
        {
          provide: AppointmentPaymentHandler,
          useFactory: (
            appointments: AppointmentRepository,
            provider: DeterministicAppointmentPaymentProvider,
            config: WorkerConfig,
          ) => new AppointmentPaymentHandler(
            appointments, selectPaymentProvider(config, provider),
          ),
          inject: [AppointmentRepository, DeterministicAppointmentPaymentProvider, WORKER_CONFIG],
        },
        {
          provide: PrescriptionPdfHandler,
          useFactory: (
            prescriptions: PrescriptionRepository,
            storage: ObjectStorageProvider,
          ) => new PrescriptionPdfHandler(prescriptions, storage),
          inject: [PrescriptionRepository, WORKER_OBJECT_STORAGE],
        },
        DeterministicPushDeliveryProvider,
        {
          provide: PushTokenCipher,
          useFactory: (config: WorkerConfig) => new PushTokenCipher(config.pushTokenEncryptionKey),
          inject: [WORKER_CONFIG],
        },
        {
          provide: NotificationPushHandler,
          useFactory: (
            notifications: NotificationRepository,
            provider: DeterministicPushDeliveryProvider,
            config: WorkerConfig,
            pushTokens: PushTokenCipher,
          ) => new NotificationPushHandler(
            notifications, selectPushProvider(config, provider), pushTokens,
          ),
          inject: [NotificationRepository, DeterministicPushDeliveryProvider, WORKER_CONFIG, PushTokenCipher],
        },
        DeterministicEmailDeliveryProvider,
        {
          provide: NotificationEmailHandler,
          useFactory: (
            notifications: NotificationRepository,
            provider: DeterministicEmailDeliveryProvider,
            config: WorkerConfig,
          ) => new NotificationEmailHandler(
            notifications, selectEmailProvider(config, provider),
          ),
          inject: [NotificationRepository, DeterministicEmailDeliveryProvider, WORKER_CONFIG],
        },
        {
          provide: AiRepository,
          useFactory: (connection: PostgresConnection) => new AiRepository(
            connection, config.aiProvider,
            new HealthContextBuilder(connection),
            new RiskScoringEngine(connection),
            new AdvancedAnomalyDetector(connection),
            new LongitudinalAnalyzer(connection),
          ),
          inject: [PostgresConnection],
        },
        {
          provide: AiGenerationHandler,
          useFactory: (ai: AiRepository, connection: PostgresConnection) =>
            new AiGenerationHandler(
              ai,
              createLlmProvider(config.aiProvider, {
                apiKey: config.aiApiKey,
                baseUrl: config.aiBaseUrl,
                model: config.aiModel,
              }),
              createKnowledgeRetriever('keyword', connection),
            ),
          inject: [AiRepository, PostgresConnection],
        },
        {
          provide: OutboxProcessor,
          useFactory: (
            fileScans: PrivateFileScanHandler,
            appointmentPayments: AppointmentPaymentHandler,
            prescriptionPdfs: PrescriptionPdfHandler,
            notificationPush: NotificationPushHandler,
            notificationEmail: NotificationEmailHandler,
            aiGenerations: AiGenerationHandler,
            broadcasts: Stage11Repository,
            chatPublisher: ChatEventPublisher,
          ) => new OutboxProcessor(
            fileScans, appointmentPayments, prescriptionPdfs, notificationPush, notificationEmail,
            aiGenerations, broadcasts, chatPublisher,
          ),
          inject: [
            PrivateFileScanHandler, AppointmentPaymentHandler,
            PrescriptionPdfHandler, NotificationPushHandler, NotificationEmailHandler,
            AiGenerationHandler, Stage11Repository, ChatEventPublisher,
          ],
        },
        /**
         * MQTT vitals ingestion bridge. Provided as undefined when MQTT is not
         * configured, so the worker starts without a broker in CI and local dev.
         * WorkerRuntime injects it @Optional() and skips start when undefined.
         */
        {
          provide: MQTT_BRIDGE,
          useFactory: (
            handler: MqttIngestionHandler,
            config: WorkerConfig,
          ): MqttBridge | undefined => {
            if (config.mqtt === undefined) return undefined;
            return new MqttBridge(handler, {
              url: config.mqtt.url,
              username: config.mqtt.username,
              password: config.mqtt.password,
              clientId: config.mqtt.clientId,
            });
          },
          inject: [MqttIngestionHandler, WORKER_CONFIG],
        },
        {
          provide: VitalReadingRepository,
          useFactory: (connection: PostgresConnection) => new VitalReadingRepository(connection),
          inject: [PostgresConnection],
        },
        {
          provide: MqttIngestionHandler,
          useFactory: (readings: VitalReadingRepository, connection: PostgresConnection) => new MqttIngestionHandler(readings, connection),
          inject: [VitalReadingRepository, PostgresConnection],
        },
        /**
         * Redis chat event publisher. Provided as undefined when Redis is not
         * configured, so the worker starts without Redis in CI and local dev.
         * WorkerRuntime injects it @Optional() and skips connect when undefined.
         */
        {
          provide: ChatEventPublisher,
          useFactory: (config: WorkerConfig): ChatEventPublisher | undefined => {
            if (config.redis === undefined) return undefined;
            return new ChatEventPublisher();
          },
          inject: [WORKER_CONFIG],
        },
        WorkerRuntime,
      ],
    };
  }
}

function createScanner(config: MalwareScannerConfig): MalwareScanner {
  return config.adapter === 'clamav'
    ? new ClamAvMalwareScanner({
        host: config.host,
        port: config.port,
        timeoutMs: config.timeoutMs,
      })
    : new DeterministicMalwareScanner();
}
