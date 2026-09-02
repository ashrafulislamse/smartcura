export const FILE_SCAN_REQUESTED_EVENT_TYPE = 'file.object.scan-requested.v1';
export const FILE_SCAN_REQUESTED_EVENT_VERSION = 1;

export const FILE_SCAN_COMPLETED_EVENT_TYPE = 'file.object.scan-completed.v1';
export const FILE_SCAN_COMPLETED_EVENT_VERSION = 1;

export const FILE_SCAN_COMPLETION_STATES = ['clean', 'infected', 'scan_failed'] as const;
export type FileScanCompletionState = typeof FILE_SCAN_COMPLETION_STATES[number];
