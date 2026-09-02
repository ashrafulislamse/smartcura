/**
 * WP-07a public surface.
 *
 * This barrel exists because `packages/database/src/index.ts` is being edited
 * concurrently by other work packages and must not be touched here. It is
 * reachable as `@smartcura/database/iot` through the subpath export added to this
 * package's `package.json`.
 *
 * TEMPORARY BY DESIGN. `HANDOFF-0014.md` lists the exact export block to add to
 * `index.ts`; once that lands, every consumer switches to `@smartcura/database`
 * and both this file and the subpath export can be deleted. Keeping the two
 * routes identical in shape is what makes that a mechanical change.
 */
export {
  DeviceRepository,
  DEVICE_RELEASE_REASON_CODES,
  serializeDevice,
  type AssignDeviceInput,
  type AssignDeviceResult,
  type DeviceAssignmentRecord,
  type DeviceCredentialTypeValue,
  type DeviceRecord,
  type DeviceReleaseReasonCode,
  type DeviceResponseSnapshot,
  type DeviceStateValue,
  type DeviceTypeValue,
  type ListDevicesInput,
  type ListOwnDevicesInput,
  type RegisterDeviceInput,
  type RegisterDeviceResult,
  type ReleaseDeviceInput,
  type ReleaseDeviceResult,
} from './device-repository.js';
export {
  VitalReadingRepository,
  VITAL_METRIC_BOUNDS,
  VITAL_METRIC_UNITS,
  PAIRED_VITAL_METRICS,
  healthAlertTransitionAllowed,
  readingDrivesAlerts,
  serializeHealthAlert,
  serializeVitalReading,
  type AcceptedReading,
  type AcknowledgeAlertInput,
  type AcknowledgeAlertResult,
  type HealthAlertRecord,
  type HealthAlertSeverityValue,
  type HealthAlertStateValue,
  type HealthThresholdComparatorValue,
  type IngestBatchInput,
  type IngestBatchOutcome,
  type IngestBatchResult,
  type IngestReadingInput,
  type ListAlertsInput,
  type ListReadingsInput,
  type ReadingSourceValue,
  type VitalMetricValue,
  type VitalReadingQualityValue,
  type VitalReadingRecord,
} from './vital-reading-repository.js';
export {
  DeviceSimulator,
  SIMULATOR_HARDWARE_PROFILE,
  commandAckTopic,
  statusTopic,
  vitalsTopic,
  type SimulatedMetric,
  type SimulatedSample,
  type SimulatedVitalsPacket,
  type SimulatorOptions,
} from './device-simulator.js';
export {
  DEVICE_CHANGED_EVENT_TYPE,
  DEVICE_CHANGED_EVENT_VERSION,
  HEALTH_ALERT_CHANGED_EVENT_TYPE,
  HEALTH_ALERT_CHANGED_EVENT_VERSION,
  VITAL_READING_CHANGED_EVENT_TYPE,
  VITAL_READING_CHANGED_EVENT_VERSION,
} from './iot-events.js';
export {
  revalidateIotActor,
  type IotActorContext,
  type IotActorFailure,
} from './iot-actor.js';
export {
  FirmwareRepository,
  DEVICE_HARDWARE_PROFILES,
  FIRMWARE_EVENT_OUTCOMES,
  FIRMWARE_ROLLOUT_STATUSES,
  compareSemver,
  serializeDeviceFirmwareEvent,
  serializeFirmwareRollout,
  serializeFirmwareVersion,
  type CreateFirmwareRolloutInput,
  type CreateFirmwareRolloutResult,
  type CreateFirmwareVersionInput,
  type CreateFirmwareVersionResult,
  type DeviceFirmwareEventRecord,
  type DeviceHardwareProfileValue,
  type FirmwareEventOutcomeValue,
  type FirmwareRolloutRecord,
  type FirmwareRolloutStatusValue,
  type FirmwareVersionRecord,
  type RecordFirmwareEventInput,
} from './firmware-repository.js';
export * from './schema-iot.js';
