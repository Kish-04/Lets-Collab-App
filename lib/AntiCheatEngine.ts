import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type * as cocoSsd from "@tensorflow-models/coco-ssd";

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
  type: "NO_FACE" | "MULTIPLE_FACES" | "LOOKING_AWAY" | "PHONE_DETECTED" | "VOICE_DETECTED" | "TAB_SWITCHED" | "TALKING_DETECTED" | "STRESS_DETECTED" | "EMOTION_ANOMALY" | "SYSTEM" | "BLINK_ANOMALY";
  message: string;
  scorePenalty: number;
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
  eyeTrackingThreshold: 0.80,
  emotionSensitivity: 0.65,
  audioVolumeThreshold: 0.05,
  headPoseMargin: 0.50,
  baselineBlinkRate: 15
};

export class AntiCheatEngine {
  private faceLandmarker: FaceLandmarker | null = null;
  private objectModel: cocoSsd.ObjectDetection | null = null;
  private isRunning: boolean = false;
  private eventCallback: ((event: AntiCheatEvent) => void) | null = null;
  private statusCallback: ((status: InitStatus, message: string) => void) | null = null;
  private lastEventTimes: Record<string, number> = {};
  private frameCount: number = 0;
  private lastTimestamp: number = 0;
  private lastPredictions: any[] | null = null;
  private audioContext: AudioContext | null = null;
  private audioAnalyser: AnalyserNode | null = null;
  private speechRecognition: any = null;
  private missingFaceFrames: number = 0;
  
  private isProcessingFace: boolean = false;
  private isProcessingObject: boolean = false;

  private lastKeyDownTime = 0;
  private keyDwellTimes: number[] = [];
  private keyFlightTimes: number[] = [];
  private baselineDwellTime = 0;
  private baselineFlightTime = 0;

  public initStatus: InitStatus = "idle";
  private config: AntiCheatConfig = DEFAULT_CONFIG;
  private blinkTimestamps: number[] = [];
  private isBlinking: boolean = false;
  private audioSpikeCount: number = 0;
  private continuousAudioStartTime: number = 0;
  private blinkBuckets: number[] = [];
  private currentBucketBlinks: number = 0;
  private lastBucketTime: number = 0;
  private sessionStartTime: number = 0;

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

  private setStatus(status: InitStatus, message: string) {
    this.initStatus = status;
    this.statusCallback?.(status, message);
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

    let volumeSamples: number[] = [];
    let poseVariances: number[] = [];
    const TOTAL_SAMPLES = 20;
    let samplesCollected = 0;

    return new Promise((resolve) => {
      const sampleInterval = setInterval(() => {
        samplesCollected++;

        if (tempAnalyser) {
          const bufferLength = tempAnalyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          tempAnalyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
          volumeSamples.push(sum / bufferLength);
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
            const avgNoise = volumeSamples.reduce((a, b) => a + b, 0) / volumeSamples.length;
            this.config.audioVolumeThreshold = Math.max(20, avgNoise + 15);
          }
          if (poseVariances.length > 5) {
            const avgVar = poseVariances.reduce((a,b)=>a+b,0)/poseVariances.length;
            this.config.headPoseMargin = Math.max(0.35, avgVar + 0.2);
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
    this.sessionStartTime = performance.now();

    if (audioStream && audioStream.getAudioTracks().length > 0) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioCtx();
        const source = this.audioContext.createMediaStreamSource(audioStream);
        this.audioAnalyser = this.audioContext.createAnalyser();
        this.audioAnalyser.fftSize = 256;
        source.connect(this.audioAnalyser);
      } catch (err) {}

      try {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          this.speechRecognition = new SpeechRecognition();
          this.speechRecognition.continuous = true;
          this.speechRecognition.interimResults = true;
          this.speechRecognition.onresult = () => {
            this.emitEvent("VOICE_DETECTED" as any, "Human voice / talking detected", 5);
          };
          this.speechRecognition.onerror = () => {};
          this.speechRecognition.start();
        }
      } catch (err) {}
    }

    const ctx = canvasElement?.getContext("2d");

    const processFrame = async () => {
      if (!this.isRunning) return;
      if (videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        if (ctx && canvasElement) {
          if (canvasElement.width !== videoElement.videoWidth) {
              canvasElement.width = videoElement.videoWidth;
              canvasElement.height = videoElement.videoHeight;
          }
          ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        }

        if (this.audioAnalyser && this.audioContext) {
          if (this.audioContext.state === 'suspended') {
              this.audioContext.resume().catch(() => {});
          }
          const dataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);
          this.audioAnalyser.getByteFrequencyData(dataArray);
          
          // Filter for human speech frequencies (approx 344Hz to 3440Hz)
          const speechBins = Array.from(dataArray).slice(2, 21);
          // Use average volume of just the speech frequencies to prevent random noise spikes from triggering it
          const avgSpeechVolume = speechBins.reduce((a, b) => a + b, 0) / speechBins.length;
          const normalizedVolume = avgSpeechVolume / 255;
          
          if (normalizedVolume > this.config.audioVolumeThreshold) {
              if (!this.speechRecognition) {
                  this.emitEvent("VOICE_DETECTED" as any, "Loud noise detected (potential talking)", 5);
              }
          }
        }

        if (this.objectModel && !this.isProcessingObject) {
          this.isProcessingObject = true;
          this.objectModel.detect(videoElement).then(predictions => {
              const forbidden = predictions.filter(p => p.class === "cell phone" || p.class === "book" || p.class === "laptop");
              if (forbidden.length > 0) {
                  this.emitEvent("FORBIDDEN_OBJECT", `Forbidden object (${forbidden[0].class}) detected`, 15);
              }
          }).catch(() => {}).finally(() => {
              setTimeout(() => { this.isProcessingObject = false; }, 800);
          });
        }

        if (this.faceLandmarker && !this.isProcessingFace) {
          try {
            this.isProcessingFace = true;
            const result = this.faceLandmarker.detectForVideo(videoElement, performance.now());
            if (result.faceLandmarks.length === 0) {
              this.missingFaceFrames++;
              if (this.missingFaceFrames > 30) {
                  this.emitEvent("NO_FACE", "Please face the camera", 10);
                  this.missingFaceFrames = 0;
              }
            } else {
              this.missingFaceFrames = 0;
              if (result.faceLandmarks.length > 1) {
                  this.emitEvent("MULTIPLE_FACES", "Multiple people detected in frame", 15);
              }
              const marks = result.faceLandmarks[0];
              const eyeW = Math.abs(marks[263].x - marks[33].x);
              if (Math.abs(marks[1].x - (marks[33].x + marks[263].x)/2) / eyeW > this.config.headPoseMargin) {
                  this.emitEvent("LOOKING_AWAY", "Direct gaze lost", 5);
              }
              if (ctx && canvasElement) {
                  ctx.strokeStyle = "rgba(0, 255, 127, 0.7)";
                  ctx.lineWidth = 2;
                  ctx.strokeRect(marks[1].x * canvasElement.width - 50, marks[1].y * canvasElement.height - 50, 100, 100);
              }
            }
          } catch (e) {} finally {
            this.isProcessingFace = false;
          }
        }
      }
      requestAnimationFrame(processFrame);
    };
    requestAnimationFrame(processFrame);
  }

  stop() {
    this.isRunning = false;
    if (this.audioContext) this.audioContext.close().catch(() => {});
    this.speechRecognition?.stop();
    this.speechRecognition = null;
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

  private emitEvent(type: AntiCheatEvent["type"], message: string, scorePenalty: number) {
    const now = Date.now();
    if (!this.lastEventTimes[type] || now - this.lastEventTimes[type] > 5000) {
      this.lastEventTimes[type] = now;
      this.eventCallback?.({ type, message, scorePenalty });
    }
  }
}
