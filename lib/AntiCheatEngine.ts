import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type * as cocoSsd from "@tensorflow-models/coco-ssd";

// Next.js dev overlay catches console.error and blocks the UI.
// TensorFlow Lite Wasm uses console.error for INFO logs by mistake.
if (typeof window !== "undefined") {
  const originalConsoleError = console.error;
  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('Created TensorFlow Lite XNNPACK delegate')) {
      return;
    }
    originalConsoleError.apply(console, args);
  };
}
export type AntiCheatEvent = {
  type: "NO_FACE" | "MULTIPLE_FACES" | "LOOKING_AWAY" | "PHONE_DETECTED" | "VOICE_DETECTED" | "TAB_SWITCHED" | "TALKING_DETECTED" | "STRESS_DETECTED" | "EMOTION_ANOMALY" | "SYSTEM";
  message: string;
  scorePenalty: number;
};

export type InitStatus = "idle" | "loading" | "ready" | "error";

export interface AntiCheatConfig {
  eyeTrackingThreshold: number;
  emotionSensitivity: number;
  audioVolumeThreshold: number;
  headPoseMargin: number;
}

const DEFAULT_CONFIG: AntiCheatConfig = {
  eyeTrackingThreshold: 0.80,
  emotionSensitivity: 0.65,
  audioVolumeThreshold: 0.05, // 5% volume threshold
  headPoseMargin: 0.50
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
  private missingFaceFrames: number = 0;
  public initStatus: InitStatus = "idle";
  private config: AntiCheatConfig = DEFAULT_CONFIG;

  public setConfig(newConfig: Partial<AntiCheatConfig>) {
    this.config = { ...this.config, ...newConfig };
    console.log("[AntiCheat] Updated config:", this.config);
  }
  
  public getConfig() {
    return this.config;
  }

  async initialize() {
    this.setStatus("loading", "Loading AI Models... (50MB)");
    try {
      // ── 1. TensorFlow backend first ──────────────────────────────────
      this.setStatus("loading", "Initializing TensorFlow.js backend…");
      const tf = await import("@tensorflow/tfjs");
      const cocoSsd = await import("@tensorflow-models/coco-ssd");
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");

      await tf.setBackend("webgl");
      await tf.ready();
      this.setStatus("loading", "TensorFlow.js ready ✓");

      // ── 2. MediaPipe FaceLandmarker ──────────────────────────────────
      this.setStatus("loading", "Loading face detection model…");
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
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
      this.setStatus("loading", "Face detection model ready ✓");

      // ── 3. COCO-SSD for phone/object detection ───────────────────────
      this.setStatus("loading", "Loading object detection model…");
      this.objectModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
      this.setStatus("loading", "Object detection model ready ✓");

      this.initStatus = "ready";
      this.setStatus("ready", "AntiCheat engine fully initialized ✓");
      console.log("[AntiCheat] Engine initialized successfully");
    } catch (err: any) {
      console.error("[AntiCheat] Initialization failed:", err);
      this.initStatus = "error";
      this.setStatus("error", `AntiCheat init failed: ${err.message}`);
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
    if (this.initStatus !== "ready") {
      console.warn("[AntiCheat] Cannot calibrate before initialization is ready.");
      return;
    }
    
    this.setStatus("loading", "Calibrating AI thresholds... (3s)");
    console.log("[AntiCheat] Starting 3-second ambient calibration phase...");

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
      } catch (err) {
        console.warn("[AntiCheat] Calibration: Audio context failed to start:", err);
      }
    } else {
      console.warn("[AntiCheat] Calibration: Mic denied or missing. Falling back to default audio threshold.");
    }

    let volumeSamples: number[] = [];
    let poseVariances: number[] = [];
    let lowConfidenceCount = 0;
    const TOTAL_SAMPLES = 30; // Sample every 100ms for 3s
    let samplesCollected = 0;

    return new Promise((resolve) => {
      const sampleInterval = setInterval(() => {
        samplesCollected++;

        // Sample Audio
        if (tempAnalyser) {
          const bufferLength = tempAnalyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          tempAnalyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          volumeSamples.push(sum / bufferLength);
        }

        // Sample Video (Face)
        if (this.faceLandmarker && videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
          const result = this.faceLandmarker.detectForVideo(videoElement, performance.now());
          const faces = result.faceLandmarks;
          if (faces.length === 1) {
            const marks = faces[0];
            if (marks && marks.length > 263) {
              const nose = marks[1].x;
              const lEye = marks[33].x;
              const rEye = marks[263].x;
              const eyeW = Math.abs(rEye - lEye);
              
              const expectedNose = (lEye + rEye) / 2;
              const offsetRatio = Math.abs(nose - expectedNose) / eyeW;
              poseVariances.push(offsetRatio);
            }
          } else {
            lowConfidenceCount++;
          }
        }

        if (samplesCollected >= TOTAL_SAMPLES) {
          clearInterval(sampleInterval);
          
          let newAudioThreshold = DEFAULT_CONFIG.audioVolumeThreshold;
          if (volumeSamples.length > 0) {
            const avgNoise = volumeSamples.reduce((a, b) => a + b, 0) / volumeSamples.length;
            // Calculate standard deviation for smarter, robust audio thresholding
            const variance = volumeSamples.reduce((a, b) => a + Math.pow(b - avgNoise, 2), 0) / volumeSamples.length;
            const stdDev = Math.sqrt(variance);
            
            // Set threshold to 3 standard deviations above the ambient noise floor (99.7% confidence)
            newAudioThreshold = avgNoise + (stdDev * 3) + 5; 
            if (newAudioThreshold < 15) newAudioThreshold = 20; // safe minimum threshold
          }

          let newHeadMargin = DEFAULT_CONFIG.headPoseMargin;
          if (poseVariances.length >= Math.ceil(TOTAL_SAMPLES / 2)) { // need at least half the samples to be valid
            const sortedVariances = [...poseVariances].sort((a, b) => a - b);
            const p95 = sortedVariances[Math.floor(sortedVariances.length * 0.95)];
            newHeadMargin = Math.max(0.3, p95 + 0.15); // pad the natural variance by 0.15
          }

          let newEyeThreshold = DEFAULT_CONFIG.eyeTrackingThreshold;
          if (lowConfidenceCount > TOTAL_SAMPLES * 0.4) {
            // More than 40% of samples had low/no confidence tracking (bad lighting)
            newEyeThreshold = 0.50; // heavily relax eye tracking to prevent false positives
            this.emitEvent("SYSTEM", "[ALERT] AI Sensitivity auto-relaxed due to low lighting/poor confidence during calibration.", 0);
          }

          this.setConfig({
            audioVolumeThreshold: newAudioThreshold,
            headPoseMargin: newHeadMargin,
            eyeTrackingThreshold: newEyeThreshold
          });

          if (tempAudioCtx) tempAudioCtx.close().catch(() => {});
          
          this.setStatus("ready", "Calibration complete ✓");
          console.log("[AntiCheat] Calibration finished. Final config:", this.config);
          resolve();
        }
      }, 100);
    });
  }

  async start(videoElement: HTMLVideoElement, canvasElement?: HTMLCanvasElement, audioStream?: MediaStream) {
    if (this.isRunning) {
      console.log("[AntiCheat] Engine is already running — skipping new start");
      return;
    }

    // Wait until ready — retry up to 30s
    let waited = 0;
    while (this.initStatus !== "ready" && waited < 30000) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
    }

    if (this.initStatus !== "ready") {
      console.warn("[AntiCheat] Engine not ready after 30s — skipping");
      return;
    }

    if (!this.faceLandmarker) {
      console.warn("[AntiCheat] FaceLandmarker not available");
      return;
    }

    this.isRunning = true;
    this.lastTimestamp = 0;
    this.lastPredictions = null;
    console.log("[AntiCheat] Starting frame analysis on video element and audio stream");

    // Initialize Web Audio API Analyser Node if mic stream is present
    if (audioStream && audioStream.getAudioTracks().length > 0) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioCtx();
        const source = this.audioContext.createMediaStreamSource(audioStream);
        this.audioAnalyser = this.audioContext.createAnalyser();
        this.audioAnalyser.fftSize = 256;
        source.connect(this.audioAnalyser);
        console.log("[AntiCheat] Web Audio API context successfully attached");
      } catch (audioErr) {
        console.warn("[AntiCheat] Audio context failed to start:", audioErr);
      }
    }

    const ctx = canvasElement ? canvasElement.getContext("2d") : null;

    const processFrame = async () => {
      if (!this.isRunning) return;
      this.frameCount++;

      // Check track enabled states dynamically from audioStream/MediaStream
      const videoTracks = audioStream ? audioStream.getVideoTracks() : [];
      const isCamEnabled = videoTracks.length === 0 || videoTracks[0].enabled;

      const audioTracks = audioStream ? audioStream.getAudioTracks() : [];
      const isMicEnabled = audioTracks.length === 0 || audioTracks[0].enabled;

      if (
        videoElement.readyState >= 2 &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0
      ) {
        // Clear canvas context
        if (ctx && canvasElement) {
          if (canvasElement.width !== videoElement.videoWidth || canvasElement.height !== videoElement.videoHeight) {
            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
          }
          ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        }

        // Monotonically increasing timestamp requirement
        let startTimeMs = performance.now();
        if (this.lastTimestamp && startTimeMs <= this.lastTimestamp) {
          startTimeMs = this.lastTimestamp + 1;
        }
        this.lastTimestamp = startTimeMs;

        let getScore = (name: string): number => 0;
        let frown = false;
        let surprise = false;
        let happy = false;

        // ── Face detection every frame ─────────────────────────────
        if (!isCamEnabled) {
          // Skip face proctoring if camera is muted by the user, render clean muted overlay
          if (ctx && canvasElement) {
            ctx.fillStyle = "rgba(10, 10, 15, 0.85)";
            ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);
            ctx.strokeStyle = "rgba(255, 59, 92, 0.4)";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(8, 8, canvasElement.width - 16, canvasElement.height - 16);

            ctx.font = "bold 11px monospace";
            ctx.fillStyle = "rgb(255, 59, 92)";
            ctx.textAlign = "center";
            ctx.fillText("● CAMERA MUTED BY USER", canvasElement.width / 2, canvasElement.height / 2 - 4);
            ctx.font = "9px monospace";
            ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
            ctx.fillText("AI Proctoring temporarily suspended", canvasElement.width / 2, canvasElement.height / 2 + 10);
            ctx.textAlign = "left"; // Restore default
          }
        } else if (this.faceLandmarker) {
          try {
            const result = this.faceLandmarker.detectForVideo(videoElement, startTimeMs);
            const faces = result.faceLandmarks;

            if (faces.length === 0) {
              this.missingFaceFrames++;
              if (this.missingFaceFrames > 15) {
                this.emitEvent("NO_FACE", "No face detected in camera", 10);
                this.missingFaceFrames = 0; // reset to avoid spamming even after debounce
              }
            } else if (faces.length > 1) {
              this.missingFaceFrames = 0;
              this.emitEvent("MULTIPLE_FACES", `${faces.length} faces detected`, 20);
            } else {
              this.missingFaceFrames = 0;
              // ── Facial Blendshapes and Micro-expressions ───────────────
              const blendshapes = result.faceBlendshapes;
              if (blendshapes && blendshapes.length > 0) {
                const categories = blendshapes[0].categories;
                getScore = (name: string): number => {
                  const found = categories.find((c: any) => c.categoryName === name || c.name === name);
                  return found ? found.score : 0;
                };

                // 1. Highly accurate Eye looking direction detection (realistic thresholds to avoid false positives)
                const lookLeft = getScore("eyeLookOutLeft") > this.config.eyeTrackingThreshold && getScore("eyeLookInRight") > this.config.eyeTrackingThreshold;
                const lookRight = getScore("eyeLookInLeft") > this.config.eyeTrackingThreshold && getScore("eyeLookOutRight") > this.config.eyeTrackingThreshold;
                const lookDown = getScore("eyeLookDownLeft") > this.config.eyeTrackingThreshold && getScore("eyeLookDownRight") > this.config.eyeTrackingThreshold;
                
                if (lookLeft) {
                  this.emitEvent("LOOKING_AWAY", "Eye tracking: Looking Left", 8);
                } else if (lookRight) {
                  this.emitEvent("LOOKING_AWAY", "Eye tracking: Looking Right", 8);
                } else if (lookDown) {
                  this.emitEvent("LOOKING_AWAY", "Eye tracking: Looking Down", 8);
                }

                // 2. Emotion / suspicious facial tension
                frown = getScore("browDownLeft") > this.config.emotionSensitivity && getScore("browDownRight") > this.config.emotionSensitivity;
                surprise = getScore("browOuterUpLeft") > (this.config.emotionSensitivity + 0.1) && getScore("browOuterUpRight") > (this.config.emotionSensitivity + 0.1);
                happy = getScore("mouthSmileLeft") > (this.config.emotionSensitivity + 0.05) && getScore("mouthSmileRight") > (this.config.emotionSensitivity + 0.05);
                
                if (frown) {
                  this.emitEvent("STRESS_DETECTED", "Facial expression: Stressed/Squinting", 5);
                } else if (surprise) {
                  this.emitEvent("EMOTION_ANOMALY", "Facial expression: Surprised", 5);
                } else if (happy) {
                  this.emitEvent("EMOTION_ANOMALY", "Facial expression: Smiling", 5);
                }

                // 3. Speaking / whispering jaw tracking
                const jawOpen = getScore("jawOpen") > 0.45;
                const mouthPucker = getScore("mouthPucker") > 0.55;
                if (jawOpen || mouthPucker) {
                  this.emitEvent("TALKING_DETECTED", "Verbal check: Whispering or speaking movements", 12);
                }
              }

              // Head pose: check if nose is between eyes with a natural threshold
              const marks = faces[0];
              if (marks && marks.length > 263) {
                const nose = marks[1].x;
                const lEye = marks[33].x;
                const rEye = marks[263].x;
                const eyeW = Math.abs(rEye - lEye);
                const margin = eyeW * this.config.headPoseMargin; // Configurable margin to prevent false head pose alerts
                if (nose < lEye - margin || nose > rEye + margin) {
                  this.emitEvent("LOOKING_AWAY", "Head pose: User looking away from screen", 5);
                }

                // Draw face tracking elements on canvas overlay
                if (ctx && canvasElement) {
                  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                  for (const lm of marks) {
                    if (lm.x < minX) minX = lm.x;
                    if (lm.x > maxX) maxX = lm.x;
                    if (lm.y < minY) minY = lm.y;
                    if (lm.y > maxY) maxY = lm.y;
                  }

                  const boxX = minX * canvasElement.width;
                  const boxY = minY * canvasElement.height;
                  const boxW = (maxX - minX) * canvasElement.width;
                  const boxH = (maxY - minY) * canvasElement.height;

                  // 1. Draw glowing outer frame
                  ctx.strokeStyle = "rgba(0, 255, 127, 0.75)";
                  ctx.lineWidth = 1.5;
                  ctx.shadowColor = "rgba(0, 255, 127, 0.4)";
                  ctx.shadowBlur = 6;
                  ctx.strokeRect(boxX, boxY, boxW, boxH);
                  ctx.shadowBlur = 0;

                  // 2. Draw thick sci-fi tracking corners
                  const len = Math.min(boxW, boxH) * 0.15;
                  ctx.fillStyle = "rgb(0, 255, 127)";
                  ctx.fillRect(boxX - 2, boxY - 2, len, 3);
                  ctx.fillRect(boxX - 2, boxY - 2, 3, len);

                  ctx.fillRect(boxX + boxW - len + 2, boxY - 2, len, 3);
                  ctx.fillRect(boxX + boxW - 1, boxY - 2, 3, len);

                  ctx.fillRect(boxX - 2, boxY + boxH - 1, len, 3);
                  ctx.fillRect(boxX - 2, boxY + boxH - len + 2, 3, len);

                  ctx.fillRect(boxX + boxW - len + 2, boxY + boxH - 1, len, 3);
                  ctx.fillRect(boxX + boxW - 1, boxY + boxH - len + 2, 3, len);

                  // 3. Draw keypoints for eyes, nose, and mouth
                  ctx.fillStyle = "rgba(0, 255, 127, 0.7)";
                  const keyPoints = [33, 263, 1, 61, 291];
                  for (const pt of keyPoints) {
                    if (marks[pt]) {
                      const px = marks[pt].x * canvasElement.width;
                      const py = marks[pt].y * canvasElement.height;
                      ctx.beginPath();
                      ctx.arc(px, py, 2.5, 0, 2 * Math.PI);
                      ctx.fill();
                    }
                  }

                  // 4. Label the face active tracking status
                  ctx.font = "bold 9px monospace";
                  ctx.fillStyle = "rgb(0, 255, 127)";
                  ctx.fillText("AI FACIAL TRACKING ACTIVE", boxX, boxY - 6);

                  // 5. Draw active proctoring HUD metrics panel
                  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
                  ctx.fillRect(10, 10, 140, 75);
                  ctx.strokeStyle = "rgba(0, 255, 127, 0.4)";
                  ctx.lineWidth = 1;
                  ctx.strokeRect(10, 10, 140, 75);

                  ctx.font = "bold 8px monospace";
                  ctx.fillStyle = "rgb(0, 255, 127)";
                  ctx.fillText("PROCTORING TELEMETRY", 15, 22);

                  const lOut = getScore("eyeLookOutLeft");
                  const rIn = getScore("eyeLookInRight");
                  const isLeft = lOut > 0.80 && rIn > 0.80;
                  const lIn = getScore("eyeLookInLeft");
                  const rOut = getScore("eyeLookOutRight");
                  const isRight = lIn > 0.80 && rOut > 0.80;
                  const isDown = getScore("eyeLookDownLeft") > 0.80 && getScore("eyeLookDownRight") > 0.80;
                  
                  let eyeDirection = "CENTER";
                  if (isLeft) eyeDirection = "LEFT [ALERT]";
                  if (isRight) eyeDirection = "RIGHT [ALERT]";
                  if (isDown) eyeDirection = "DOWN [ALERT]";

                  ctx.fillStyle = "rgb(255, 255, 255)";
                  ctx.fillText(`Eye Dir: ${eyeDirection}`, 15, 34);

                  const isTalking = getScore("jawOpen") > 0.45;
                  ctx.fillText(`Speaking: ${isTalking ? "YES [ALERT]" : "NO"}`, 15, 46);

                  let emotion = "Neutral";
                  if (frown) emotion = "Stressed/Frowning";
                  if (surprise) emotion = "Surprised";
                  if (happy) emotion = "Smiling";
                  ctx.fillText(`Emotion: ${emotion}`, 15, 58);

                  ctx.fillText(`Audio Lvl: ${isMicEnabled ? "Active" : "Disabled/Muted"}`, 15, 70);
                }
              }
            }
          } catch (faceErr) {
            // Silently ignore per-frame errors
          }
        }

        // ── Audio frequency and loudness analysis ───────────────────
        if (this.audioAnalyser) {
          let avgVolume = 0;

          if (isMicEnabled) {
            const bufferLength = this.audioAnalyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            this.audioAnalyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
              sum += dataArray[i];
            }
            avgVolume = sum / bufferLength;

            // Sound threshold violation (e.g. speaking/loud whispering) based on calibrated threshold
            if (avgVolume > this.config.audioVolumeThreshold) {
              this.emitEvent("VOICE_DETECTED", `Voice / audio anomaly detected (${Math.round(avgVolume)} dB, threshold: ${Math.round(this.config.audioVolumeThreshold)})`, 15);
            }
          }

          // Draw real-time voice amplitude waveform
          if (ctx && canvasElement) {
            const bufferLength = this.audioAnalyser.frequencyBinCount;
            const timeDomainArray = new Uint8Array(bufferLength);
            this.audioAnalyser.getByteTimeDomainData(timeDomainArray);

            ctx.beginPath();
            ctx.strokeStyle = isMicEnabled ? "rgba(0, 255, 127, 0.65)" : "rgba(255, 59, 92, 0.3)";
            ctx.lineWidth = 1.5;

            const sliceWidth = canvasElement.width / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
              const v = isMicEnabled ? timeDomainArray[i] / 128.0 : 1.0;
              const y = (v * (canvasElement.height * 0.15)) + (canvasElement.height * 0.82);

              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }

              x += sliceWidth;
            }

            ctx.lineTo(canvasElement.width, canvasElement.height * 0.82);
            ctx.stroke();

            ctx.font = "bold 8px monospace";
            ctx.fillStyle = isMicEnabled ? "rgb(0, 255, 127)" : "rgb(255, 59, 92)";
            ctx.fillText(isMicEnabled ? "MIC VOICE ACTIVITY MONITOR" : "MIC MUTED / NO AUDIO FEED", 10, canvasElement.height * 0.80);
          }
        }

        // ── Object detection every ~20 frames ─────────────────────
        if (this.objectModel && this.frameCount % 20 === 0) {
          try {
            const predictions = await this.objectModel.detect(videoElement);
            this.lastPredictions = predictions;
            const hasPhone = predictions.some(p => p.class === "cell phone" && p.score > 0.5);
            if (hasPhone) {
              this.emitEvent("PHONE_DETECTED", "Unauthorized device (phone) detected", 30);
            }
          } catch (objErr) {
            // Silently ignore
          }
        }

        // Draw cached object predictions (like cell phone)
        if (ctx && canvasElement && this.lastPredictions) {
          for (const pred of this.lastPredictions) {
            if (pred.class === "cell phone" && pred.score > 0.5) {
              const [x, y, w, h] = pred.bbox;
              const scaleX = canvasElement.width / videoElement.videoWidth;
              const scaleY = canvasElement.height / videoElement.videoHeight;
              
              ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
              ctx.lineWidth = 2;
              ctx.shadowColor = "rgba(255, 0, 0, 0.5)";
              ctx.shadowBlur = 8;
              ctx.strokeRect(x * scaleX, y * scaleY, w * scaleX, h * scaleY);
              ctx.shadowBlur = 0;

              ctx.font = "bold 10px monospace";
              ctx.fillStyle = "rgb(255, 0, 0)";
              ctx.fillText(`WARNING: PHONE DETECTED (${Math.round(pred.score * 100)}%)`, x * scaleX, (y * scaleY) - 6);
            }
          }
        }
      }

      requestAnimationFrame(processFrame);
    };

    requestAnimationFrame(processFrame);
  }

  stop() {
    this.isRunning = false;
    if (this.audioContext) {
      this.audioContext.close().catch(() => { });
      this.audioContext = null;
    }
    this.audioAnalyser = null;
    console.log("[AntiCheat] Stopped");
  }

  private emitEvent(type: AntiCheatEvent["type"], message: string, scorePenalty: number) {
    const now = Date.now();
    if (!this.lastEventTimes[type] || now - this.lastEventTimes[type] > 3000) {
      this.lastEventTimes[type] = now;
      this.eventCallback?.({ type, message, scorePenalty });
    }
  }
}
