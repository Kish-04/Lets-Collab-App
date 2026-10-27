import { acquireFaceTracker, type FaceTracker } from "./faceLandmarker";
import { acquireObjectDetector, type ObjectTracker } from "./objectDetector";
import type { ProctoringSeverity } from "./proctoringPolicy";

// Robust suppression of Next.js Turbopack dev overlay for AI Wasm errors
if (typeof window !== "undefined") {
  const originalError = console.error;
  console.error = (...args) => {
    const msg = String(args[0] || '').toLowerCase();
    const suppressedTerms = ['index out of bounds', 'abort', 'wasm', 'memory', 'delegate', 'task failed'];
    if (suppressedTerms.some(term => msg.includes(term))) {
      return;
    }
    originalError.apply(console, args);
  };
}

export type AntiCheatEvent = {
  type: string;
  message: string;
  scorePenalty: number;
  severity?: ProctoringSeverity;
};

export type InitStatus = "idle" | "loading" | "ready" | "error";

export interface AntiCheatConfig {
  eyeTrackingThreshold: number;
  emotionSensitivity: number;
  audioVolumeThreshold: number;
  headPoseMargin: number;
  baselineBlinkRate: number;
}

const DEFAULT_CONFIG: AntiCheatConfig = {
  eyeTrackingThreshold: 0.60,
  emotionSensitivity: 0.65,
  audioVolumeThreshold: 0.05,
  headPoseMargin: 0.30,
  baselineBlinkRate: 15
};

/** Longest the calibration step waits for the candidate's face */
const CALIBRATION_MS = 3000;

// Start-up of supervised proctoring on the candidate's device: loads the shared on-device models
// (face landmarker, object detector), waits until the camera shows the candidate's face, and reports
// the status the candidate sees. The detection itself runs in ONE camera pipeline
// (hooks/useFaceProctoring) and ONE audio pipeline (hooks/useAudioProctoring); this class used to run
// a second face model and a second object model (TensorFlow.js COCO-SSD) over the same camera, which
// doubled the work and reported the same moment twice. Holding the shared models here keeps them
// loaded for those hooks.
export class AntiCheatEngine {
  private face: FaceTracker | null = null;
  private objects: ObjectTracker | null = null;
  private statusCallback: ((status: InitStatus, message: string) => void) | null = null;
  private config: AntiCheatConfig = { ...DEFAULT_CONFIG };
  private stopped = false;

  public initStatus: InitStatus = "idle";

  public setConfig(newConfig: Partial<AntiCheatConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig() {
    return this.config;
  }

  onStatusChange(callback: (status: InitStatus, message: string) => void) {
    this.statusCallback = callback;
  }

  private setStatus(status: InitStatus, message: string) {
    if (this.stopped) return;
    this.initStatus = status;
    this.statusCallback?.(status, message);
  }

  async initialize() {
    this.setStatus("loading", "Initializing AI Proctoring...");
    this.face = acquireFaceTracker({ numFaces: 3, minConfidence: 0.4 });
    this.objects = acquireObjectDetector();
    // Object detection is helpful but optional: the face model is what proctoring cannot do without
    this.objects.ready.catch(err => console.warn("[AntiCheat] Object detection unavailable:", err));
    try {
      await this.face.ready;
      this.setStatus("ready", "AI Shield Active ✓");
    } catch (err: any) {
      console.warn("[AntiCheat] Init Error:", err);
      this.setStatus("error", `Engine failed: ${err?.message || err}`);
    }
  }

  /** Waits (up to 3 s) until the camera shows exactly one face, so proctoring starts from a good frame */
  async calibrate(videoElement: HTMLVideoElement): Promise<void> {
    if (this.initStatus !== "ready" || !this.face) return;
    this.setStatus("loading", "Calibrating camera...");
    const face = this.face;
    const started = Date.now();
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.stopped || Date.now() - started > CALIBRATION_MS) return resolve();
        // Shares the frame's result with the proctoring loop (one inference per camera frame)
        const result = face.detect(videoElement);
        if (result && result.faceLandmarks.length === 1) return resolve();
        setTimeout(check, 150);
      };
      check();
    });
    this.setStatus("ready", "Proctoring Ready ✓");
  }

  stop() {
    this.stopped = true;
    this.face?.release();
    this.objects?.release();
    this.face = null;
    this.objects = null;
  }
}
