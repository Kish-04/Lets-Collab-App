import { NativeModule, requireOptionalNativeModule } from 'expo';

/** One analysed camera frame. Only these numbers ever leave the native module; frames never do. */
export type ProctoringAnalysis = {
  timestamp: number;
  width: number;
  height: number;
  faceCount: number;
  /** Nose-tip offset from the eye-corner midpoint in eye widths (same metric as the web). Null without a face. */
  headOffset: number | null;
  /** Highest MediaPipe `eyeLook*` blendshape score of the first face (0..1). */
  maxEyeLook: number;
  objectDetection: boolean;
  objects: { label: string; score: number }[];
};

type LcProctoringEvents = {
  onAnalysis(event: ProctoringAnalysis): void;
  onError(event: { message: string }): void;
};

declare class LcProctoringNativeModule extends NativeModule<LcProctoringEvents> {
  readonly processorName: string;
  /** Loads the models and registers the pass-through frame processor with react-native-webrtc. */
  start(faceModelUri: string, objectModelUri: string | null, intervalMs: number): Promise<{ objectDetection: boolean }>;
  stop(): void;
}

/**
 * Null when the running binary was built without this local module (e.g. an older dev build,
 * Expo Go or web). Callers must treat that as "proctoring unavailable", never as "no violation".
 */
export default requireOptionalNativeModule<LcProctoringNativeModule>('LcProctoring');
