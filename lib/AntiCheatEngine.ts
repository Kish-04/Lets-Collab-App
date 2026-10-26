import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type * as cocoSsd from "@tensorflow-models/coco-ssd";
import { SustainedSignal, proctoringRule, audioProctoringSuppressed, type ProctoringSeverity } from "./proctoringPolicy";

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
  type: "NO_FACE" | "MULTIPLE_FACES" | "LOOKING_AWAY" | "PHONE_DETECTED" | "VOICE_DETECTED" | "TAB_SWITCHED" | "TALKING_DETECTED" | "STRESS_DETECTED" | "EMOTION_ANOMALY" | "SYSTEM" | "BLINK_ANOMALY" | "FORBIDDEN_OBJECT" | "FACE_OUT_OF_FRAME";
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
  // Normalised 0-1 level of the speech band (see speechBandLevel), the same scale calibrate() writes
  audioVolumeThreshold: 0.05,
  headPoseMargin: 0.30,
  baselineBlinkRate: 15
};

// Supervised-mode strictness. The host's calibration can make these stricter, never laxer.
const STRICT = {
  /** Nose offset from the eye midpoint, in eye widths; ~0.30 is a head turn of roughly 35 degrees */
  MAX_HEAD_POSE_MARGIN: 0.32,
  MIN_HEAD_POSE_MARGIN: 0.20,
  /** Horizontal gaze (average of the two eyes' eyeLookIn/Out blendshapes) */
  MAX_GAZE_THRESHOLD: 0.60,
  /** Face analysis rate (ms between frames) and object detection rate */
  FACE_INTERVAL_MS: 100,
  OBJECT_INTERVAL_MS: 700,
  /** COCO-SSD per-class minimum confidence. Phones are small, so they get the lowest bar. */
  OBJECT_MIN_SCORE: { 'cell phone': 0.45, 'book': 0.55, 'laptop': 0.60, 'tv': 0.60, 'person': 0.60 } as Record<string, number>,
  /** A face narrower than this fraction of the frame is too far away to proctor */
  MIN_FACE_WIDTH: 0.12,
};

const OBJECT_TEXT: Record<string, string> = {
  'cell phone': 'Phone detected on camera',
  'book': 'Book or notes detected on camera',
  'laptop': 'Second laptop/device detected on camera',
  'tv': 'Second screen detected on camera',
};

export class AntiCheatEngine {
  private faceLandmarker: FaceLandmarker | null = null;
  private objectModel: cocoSsd.ObjectDetection | null = null;
  private isRunning: boolean = false;
  private eventCallback: ((event: AntiCheatEvent) => void) | null = null;
  private statusCallback: ((status: InitStatus, message: string) => void) | null = null;
  private lastEventTimes: Record<string, number> = {};
  private audioContext: AudioContext | null = null;
  private audioAnalyser: AnalyserNode | null = null;

  private isProcessingFace: boolean = false;
  private isProcessingObject: boolean = false;
  private lastFaceAt = 0;
  private lastObjectAt = 0;
  private lastAudioAt = 0;

  // Sustained-detection windows: one bad frame never raises an alarm
  private signals = {
    noFace: new SustainedSignal(3000, 0.85),
    multipleFaces: new SustainedSignal(2000, 0.6),
    headPose: new SustainedSignal(2000, 0.8),
    gaze: new SustainedSignal(2500, 0.8),
    outOfFrame: new SustainedSignal(5000, 0.8, 15000),
    // Objects are sampled ~1.4 times a second: 2 of ~4 samples within 3 s
    phone: new SustainedSignal(3000, 0.5, 8000, 2),
    book: new SustainedSignal(3000, 0.5, 8000, 2),
    screen: new SustainedSignal(3000, 0.6, 10000, 2),
    person: new SustainedSignal(3000, 0.6, 10000, 2),
    // Speech-band energy sampled every 100 ms: talking is 60% of 1.5 s above the calibrated level
    talking: new SustainedSignal(1500, 0.6, 6000, 8),
  };

  private lastKeyDownTime = 0;
  private keyDwellTimes: number[] = [];
  private baselineDwellTime = 0;

  public initStatus: InitStatus = "idle";
  private config: AntiCheatConfig = { ...DEFAULT_CONFIG };

  public setConfig(newConfig: Partial<AntiCheatConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig() {
    return this.config;
  }

  async initialize() {
    this.setStatus("loading", "Initializing AI Proctoring...");
    try {
      const tf = await import("@tensorflow/tfjs");
      const cocoSsd = await import("@tensorflow-models/coco-ssd");
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");

      await tf.setBackend("webgl");
      await tf.ready();

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm"
      );
      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
          delegate: "GPU",
        },
        outputFaceBlendshapes: true,
        runningMode: "VIDEO",
        numFaces: 3,
        // Stricter than the 0.5 default so a face half out of frame or a face on a poster still counts
        minFaceDetectionConfidence: 0.4,
        minFacePresenceConfidence: 0.4,
      });

      this.objectModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });

      this.initStatus = "ready";
      this.setStatus("ready", "AI Shield Active ✓");
    } catch (err: any) {
      console.error("[AntiCheat] Init Error:", err);
      this.initStatus = "error";
      this.setStatus("error", `Engine failed: ${err.message}`);
    }
  }

  onEvent(callback: (event: AntiCheatEvent) => void) {
    this.eventCallback = callback;
  }

  onStatusChange(callback: (status: InitStatus, message: string) => void) {
    this.statusCallback = callback;
  }

  // Average of the speech-frequency bins (approx 344Hz to 3440Hz at fftSize 256), normalised to 0-1.
  // Calibration and the runtime check both use this, so the stored threshold means the same thing.
  private speechBandLevel(analyser: AnalyserNode) {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    const speechBins = Array.from(dataArray).slice(2, 21);
    if (speechBins.length === 0) return 0;
    return speechBins.reduce((a, b) => a + b, 0) / speechBins.length / 255;
  }

  private setStatus(status: InitStatus, message: string) {
    this.initStatus = status;
    this.statusCallback?.(status, message);
  }

  private headPoseMargin() {
    return Math.min(STRICT.MAX_HEAD_POSE_MARGIN, Math.max(STRICT.MIN_HEAD_POSE_MARGIN, this.config.headPoseMargin));
  }

  async calibrate(videoElement: HTMLVideoElement, audioStream?: MediaStream): Promise<void> {
    if (this.initStatus !== "ready") return;
    this.setStatus("loading", "Calibrating Environment...");

    let tempAudioCtx: AudioContext | null = null;
    let tempAnalyser: AnalyserNode | null = null;

    if (audioStream && audioStream.getAudioTracks().length > 0 && audioStream.getAudioTracks()[0].enabled) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        tempAudioCtx = new AudioCtx();
        const source = tempAudioCtx.createMediaStreamSource(audioStream);
        tempAnalyser = tempAudioCtx.createAnalyser();
        tempAnalyser.fftSize = 256;
        source.connect(tempAnalyser);
      } catch (err) {}
    }

    const volumeSamples: number[] = [];
    const poseVariances: number[] = [];
    // 3 s of samples: enough for a stable ambient-noise and resting head-pose baseline
    const TOTAL_SAMPLES = 30;
    let samplesCollected = 0;

    return new Promise((resolve) => {
      const sampleInterval = setInterval(() => {
        samplesCollected++;

        if (tempAnalyser) {
          volumeSamples.push(this.speechBandLevel(tempAnalyser));
        }

        if (this.faceLandmarker && videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
          try {
            const result = this.faceLandmarker.detectForVideo(videoElement, performance.now());
            const faces = result.faceLandmarks;
            if (faces.length === 1) {
              const marks = faces[0];
              const eyeW = Math.abs(marks[263].x - marks[33].x);
              poseVariances.push(Math.abs(marks[1].x - (marks[33].x + marks[263].x) / 2) / eyeW);
            }
          } catch(e) {}
        }

        if (samplesCollected >= TOTAL_SAMPLES) {
          clearInterval(sampleInterval);
          if (volumeSamples.length > 0) {
            // Median, so one cough during calibration does not raise the bar for the whole exam
            const sorted = [...volumeSamples].sort((a, b) => a - b);
            const ambient = sorted[Math.floor(sorted.length / 2)];
            // Speech must clear the room noise by 12 (0-255 byte scale), and never sit under 16
            this.config.audioVolumeThreshold = Math.max(16 / 255, ambient + 12 / 255);
          }
          if (poseVariances.length > 5) {
            const avgVar = poseVariances.reduce((a,b)=>a+b,0)/poseVariances.length;
            // Resting offset (camera not centred) plus a margin, clamped to the strict range
            this.config.headPoseMargin = Math.min(STRICT.MAX_HEAD_POSE_MARGIN, Math.max(STRICT.MIN_HEAD_POSE_MARGIN, avgVar + 0.15));
          }
          if (tempAudioCtx) tempAudioCtx.close().catch(() => {});
          this.setStatus("ready", "Proctoring Ready ✓");
          resolve();
        }
      }, 100);
    });
  }

  async start(videoElement: HTMLVideoElement, canvasElement?: HTMLCanvasElement, audioStream?: MediaStream) {
    if (this.isRunning) return;
    this.isRunning = true;

    // Talking is detected on this device from the speech band of the microphone. The browser's
    // SpeechRecognition (which streams audio to a cloud service and is missing in Electron/Firefox)
    // is no longer used; on-device speech/whisper/conversation classification runs in useAudioProctoring.
    if (audioStream && audioStream.getAudioTracks().length > 0) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioCtx();
        const source = this.audioContext.createMediaStreamSource(audioStream);
        this.audioAnalyser = this.audioContext.createAnalyser();
        this.audioAnalyser.fftSize = 256;
        // Smooth over ~100 ms so short clicks (typing) do not look like speech
        this.audioAnalyser.smoothingTimeConstant = 0.6;
        source.connect(this.audioAnalyser);
      } catch (err) {}
    }

    const ctx = canvasElement?.getContext("2d");

    const processFrame = async () => {
      if (!this.isRunning) return;
      const now = performance.now();
      const wallNow = Date.now();

      if (this.audioAnalyser && this.audioContext && now - this.lastAudioAt >= 100) {
        this.lastAudioAt = now;
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
        }
        // Average volume of just the speech frequencies, so random noise spikes do not count
        const level = this.speechBandLevel(this.audioAnalyser);
        const loud = level > this.config.audioVolumeThreshold && !audioProctoringSuppressed(wallNow);
        if (this.signals.talking.update(loud, wallNow)) {
          this.emitEvent("VOICE_DETECTED", "Talking detected (sustained voice-level sound on the microphone)");
        }
      }

      if (videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        if (ctx && canvasElement) {
          if (canvasElement.width !== videoElement.videoWidth) {
              canvasElement.width = videoElement.videoWidth;
              canvasElement.height = videoElement.videoHeight;
          }
        }

        if (this.objectModel && !this.isProcessingObject && now - this.lastObjectAt >= STRICT.OBJECT_INTERVAL_MS) {
          this.isProcessingObject = true;
          this.lastObjectAt = now;
          this.objectModel.detect(videoElement, 10, 0.3).then(predictions => {
              const seen = (cls: string) => predictions.find(p => p.class === cls && p.score >= (STRICT.OBJECT_MIN_SCORE[cls] ?? 0.6));
              const t = Date.now();
              const phone = seen('cell phone');
              const book = seen('book');
              const screen = seen('laptop') || seen('tv');
              const people = predictions.filter(p => p.class === 'person' && p.score >= STRICT.OBJECT_MIN_SCORE.person).length;
              if (this.signals.phone.update(!!phone, t) && phone) {
                  this.emitEvent("FORBIDDEN_OBJECT", `${OBJECT_TEXT['cell phone']} (${Math.round(phone.score * 100)}% confidence)`, undefined, 'object:phone');
              }
              if (this.signals.book.update(!!book, t) && book) {
                  this.emitEvent("FORBIDDEN_OBJECT", `${OBJECT_TEXT.book} (${Math.round(book.score * 100)}% confidence)`, undefined, 'object:book');
              }
              if (this.signals.screen.update(!!screen, t) && screen) {
                  this.emitEvent("FORBIDDEN_OBJECT", `${OBJECT_TEXT[screen.class] || 'Second screen detected'} (${Math.round(screen.score * 100)}% confidence)`, undefined, 'object:screen');
              }
              // A second person can be in frame without showing their face (behind or beside the candidate)
              if (this.signals.person.update(people >= 2, t)) {
                  this.emitEvent("MULTIPLE_FACES", `${people} people detected in the camera view`);
              }
          }).catch(() => {}).finally(() => {
              this.isProcessingObject = false;
          });
        }

        if (this.faceLandmarker && !this.isProcessingFace && now - this.lastFaceAt >= STRICT.FACE_INTERVAL_MS) {
          this.lastFaceAt = now;
          try {
            this.isProcessingFace = true;
            this.analyseFaces(this.faceLandmarker.detectForVideo(videoElement, now), wallNow, ctx || null, canvasElement);
          } catch (e) {} finally {
            this.isProcessingFace = false;
          }
        }
      }
      requestAnimationFrame(processFrame);
    };
    requestAnimationFrame(processFrame);
  }

  private analyseFaces(result: ReturnType<FaceLandmarker['detectForVideo']>, now: number, ctx: CanvasRenderingContext2D | null, canvasElement?: HTMLCanvasElement) {
    const faces = result.faceLandmarks || [];
    if (this.signals.noFace.update(faces.length === 0, now)) {
      this.emitEvent("NO_FACE", "No face visible on camera for 3 seconds");
    }
    if (this.signals.multipleFaces.update(faces.length > 1, now)) {
      this.emitEvent("MULTIPLE_FACES", `${faces.length} faces detected in the camera view`);
    }
    if (ctx && canvasElement) ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (faces.length === 0) {
      // Pose and gaze cannot be judged without a face; start their windows afresh when it returns
      this.signals.headPose.update(false, now);
      this.signals.gaze.update(false, now);
      return;
    }

    const marks = faces[0];
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const m of marks) {
      if (m.x < minX) minX = m.x;
      if (m.x > maxX) maxX = m.x;
      if (m.y < minY) minY = m.y;
      if (m.y > maxY) maxY = m.y;
    }
    const tooFar = maxX - minX < STRICT.MIN_FACE_WIDTH;
    const clipped = minX < 0.005 || maxX > 0.995 || minY < 0.005 || maxY > 0.995;
    if (this.signals.outOfFrame.update(tooFar || clipped, now)) {
      this.emitEvent("FACE_OUT_OF_FRAME", tooFar ? "Face too far from the camera" : "Face partly out of the camera frame");
    }

    const eyeW = Math.abs(marks[263].x - marks[33].x) || 1e-6;
    const poseOffset = Math.abs(marks[1].x - (marks[33].x + marks[263].x) / 2) / eyeW;
    if (this.signals.headPose.update(poseOffset > this.headPoseMargin(), now)) {
      this.emitEvent("LOOKING_AWAY", "Head turned away from the screen for 2 seconds");
    }

    const shapes = result.faceBlendshapes?.[0]?.categories;
    if (shapes && shapes.length > 0) {
      const score = (name: string) => shapes.find(s => s.categoryName === name)?.score ?? 0;
      const blinking = (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2 > 0.5;
      // Both eyes turned the same way (left eye out + right eye in, or the reverse). Looking down at the
      // keyboard is allowed, so only sideways and upward gaze count.
      const sideways = Math.max(
        (score('eyeLookOutLeft') + score('eyeLookInRight')) / 2,
        (score('eyeLookInLeft') + score('eyeLookOutRight')) / 2,
      );
      const up = (score('eyeLookUpLeft') + score('eyeLookUpRight')) / 2;
      const threshold = Math.min(STRICT.MAX_GAZE_THRESHOLD, this.config.eyeTrackingThreshold);
      const away = !blinking && (sideways > threshold || up > threshold + 0.1);
      if (this.signals.gaze.update(away, now)) {
        this.emitEvent("LOOKING_AWAY", "Eyes off the screen (sideways gaze) for over 2 seconds");
      }
    }

    if (ctx && canvasElement) {
      ctx.strokeStyle = "rgba(0, 255, 127, 0.7)";
      ctx.lineWidth = 2;
      ctx.strokeRect(minX * canvasElement.width, minY * canvasElement.height, (maxX - minX) * canvasElement.width, (maxY - minY) * canvasElement.height);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.audioContext) this.audioContext.close().catch(() => {});
    this.audioContext = null;
    this.audioAnalyser = null;
    Object.values(this.signals).forEach(signal => signal.reset());
  }

  public handleKeyEvent(type: 'keydown' | 'keyup', key: string) {
      if (this.initStatus !== 'ready') return;
      const now = performance.now();
      if (type === 'keydown') this.lastKeyDownTime = now;
      else if (type === 'keyup' && this.lastKeyDownTime > 0) {
          const dwell = now - this.lastKeyDownTime;
          if (this.baselineDwellTime > 0 && dwell > this.baselineDwellTime * 3) {
              this.emitEvent("SYSTEM", "Typing pattern anomaly", 2);
          } else if (this.keyDwellTimes.length < 50) {
              this.keyDwellTimes.push(dwell);
              if (this.keyDwellTimes.length === 50) {
                  this.baselineDwellTime = this.keyDwellTimes.reduce((a,b)=>a+b,0)/50;
              }
          }
      }
  }

  /** Penalty and severity default to the shared proctoring policy for the event's kind */
  private emitEvent(type: AntiCheatEvent["type"], message: string, scorePenalty?: number, throttleKey: string = type) {
    const now = Date.now();
    if (!this.lastEventTimes[throttleKey] || now - this.lastEventTimes[throttleKey] > 5000) {
      this.lastEventTimes[throttleKey] = now;
      const rule = proctoringRule(type);
      this.eventCallback?.({ type, message, scorePenalty: scorePenalty ?? rule.penalty, severity: rule.severity });
    }
  }
}
