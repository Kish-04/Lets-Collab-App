/**
 * On-device proctoring for supervised rooms. The session screen only depends on this barrel, so the
 * frame source (currently the `lc-proctoring` native module) or the models can be swapped here.
 */
export { useOnDeviceProctoring } from './useOnDeviceProctoring';
export type { ProctoringState, ProctoringStatus } from './useOnDeviceProctoring';
export { ProctoringPolicy, PROCTORING_CONFIG } from './policy';
export type { ProctoringEventType, ProctoringViolation } from './policy';
