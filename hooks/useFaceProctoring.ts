import { useEffect, useRef } from 'react';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { CAMERA_HEALTH, SustainedSignal, cameraFrameProblem, lumaDifference, toLuma } from '@/lib/proctoringPolicy';

// Supervised-exam camera checks. Every check needs the condition over most of a short window
// (SustainedSignal), so a single bad frame, a blink or a quick glance never raises an alarm.
const PROCTOR_CONFIG = {
    /** Face analysis rate: ~12 frames a second is plenty and leaves the GPU for the session */
    FRAME_INTERVAL_MS: 80,
    /** Head pose relative to the candidate's own resting pose (measured over the first frames) */
    HEAD_YAW_THRESHOLD: 0.33,   // rad, ~19 degrees left/right
    HEAD_PITCH_THRESHOLD: 0.30, // rad, ~17 degrees up/down
    BASELINE_FRAMES: 30,
    /** Horizontal gaze from the eyeLookIn/Out blendshapes (both eyes the same way) */
    GAZE_SIDEWAYS_THRESHOLD: 0.55,
    GAZE_UP_THRESHOLD: 0.65,
    /** Face narrower than this fraction of the frame is too far away */
    MIN_FACE_WIDTH: 0.12,
    /** Camera health sampling (thumbnail luma) */
    HEALTH_INTERVAL_MS: 500,
    /** No usable camera track (ended, muted by the OS/privacy switch, disabled) for this long */
    CAMERA_OFF_MS: 10000,
};

export function useFaceProctoring(
    videoRef: React.RefObject<HTMLVideoElement | null>,
    sessionMode: string | null,
    role: string | null,
    onViolation: (type: string, message: string) => void
) {
    // Callers pass an inline callback; keep the latest one in a ref so the detection loop is not
    // torn down and restarted on every render
    const onViolationRef = useRef(onViolation);
    onViolationRef.current = onViolation;

    const landmarkerRef = useRef<FaceLandmarker | null>(null);
    const requestRef = useRef<number>(0);
    const lastVideoTime = useRef(-1);
    const isProcessing = useRef(false);

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            return;
        }

        let isMounted = true;

        async function initModel() {
            try {
                const filesetResolver = await FilesetResolver.forVisionTasks(
                    "/wasm"
                );
                const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
                    baseOptions: {
                        modelAssetPath: "/models/face_landmarker.task",
                        delegate: "GPU"
                    },
                    outputFaceBlendshapes: true,
                    outputFacialTransformationMatrixes: true,
                    runningMode: "VIDEO",
                    numFaces: 5,
                    minFaceDetectionConfidence: 0.4,
                    minFacePresenceConfidence: 0.4,
                });
                if (isMounted) landmarkerRef.current = faceLandmarker;
                else faceLandmarker.close(); // finished loading after unmount: release its GPU/Wasm memory
            } catch (err) {
                console.warn("Failed to initialize FaceLandmarker:", err);
            }
        }

        initModel();

        return () => {
            isMounted = false;
            if (landmarkerRef.current) {
                landmarkerRef.current.close();
                landmarkerRef.current = null;
            }
        };
    }, [sessionMode, role]);

    // Face presence, people count, head pose, gaze and framing
    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') return;

        const signals = {
            noFace: new SustainedSignal(2500, 0.85),
            multipleFaces: new SustainedSignal(1500, 0.6),
            headPose: new SustainedSignal(1500, 0.75),
            gaze: new SustainedSignal(2000, 0.8),
            outOfFrame: new SustainedSignal(4000, 0.8, 15000),
        };
        const baseline = { yaw: [] as number[], pitch: [] as number[], yaw0: 0, pitch0: 0, ready: false };
        let lastRun = 0;

        const processFrame = () => {
            const videoElement = videoRef.current;
            if (!landmarkerRef.current || isProcessing.current || !videoElement) {
                requestRef.current = requestAnimationFrame(processFrame);
                return;
            }

            const nowInMs = performance.now();
            if (nowInMs - lastRun >= PROCTOR_CONFIG.FRAME_INTERVAL_MS && videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
                if (videoElement.currentTime !== lastVideoTime.current) {
                    lastVideoTime.current = videoElement.currentTime;
                    lastRun = nowInMs;

                    const originalError = console.error;
                    console.error = (...args: any[]) => {
                        const msg = String(args[0] || '').toLowerCase();
                        if (msg.includes('index out of bounds') || msg.includes('abort') || msg.includes('wasm') || msg.includes('memory')) {
                            return;
                        }
                        originalError.apply(console, args);
                    };

                    try {
                        isProcessing.current = true;
                        const results = landmarkerRef.current.detectForVideo(videoElement, nowInMs);
                        const numFaces = results.faceLandmarks ? results.faceLandmarks.length : 0;
                        const now = Date.now();
                        const report = (type: string, message: string) => onViolationRef.current(type, message);

                        if (signals.noFace.update(numFaces === 0, now)) {
                            report('no_face', "No face detected — please sit in front of the camera and face the screen.");
                        }
                        if (signals.multipleFaces.update(numFaces > 1, now)) {
                            report('multiple_faces', `${numFaces} faces detected — you must be alone during the exam.`);
                        }

                        if (numFaces >= 1) {
                            const marks = results.faceLandmarks[0];
                            let minX = 1, maxX = 0, minY = 1, maxY = 0;
                            for (const m of marks) {
                                if (m.x < minX) minX = m.x;
                                if (m.x > maxX) maxX = m.x;
                                if (m.y < minY) minY = m.y;
                                if (m.y > maxY) maxY = m.y;
                            }
                            const tooFar = maxX - minX < PROCTOR_CONFIG.MIN_FACE_WIDTH;
                            const clipped = minX < 0.005 || maxX > 0.995 || minY < 0.005 || maxY > 0.995;
                            if (signals.outOfFrame.update(tooFar || clipped, now)) {
                                report('face_out_of_frame', tooFar
                                    ? 'Your face is too far from the camera — please move closer.'
                                    : 'Your face is partly out of frame — please centre yourself in the camera.');
                            }
                        }

                        if (numFaces === 1 && results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
                            const matrix = results.facialTransformationMatrixes[0].data;
                            const yaw = Math.atan2(matrix[8], matrix[10]);
                            const pitch = Math.asin(Math.max(-1, Math.min(1, -matrix[9])));

                            // The camera is rarely straight in front of the candidate: measure their resting
                            // pose first and judge turns relative to it (capped so a turned start is not "normal")
                            if (!baseline.ready) {
                                baseline.yaw.push(yaw);
                                baseline.pitch.push(pitch);
                                if (baseline.yaw.length >= PROCTOR_CONFIG.BASELINE_FRAMES) {
                                    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
                                    baseline.yaw0 = Math.max(-0.25, Math.min(0.25, median(baseline.yaw)));
                                    baseline.pitch0 = Math.max(-0.25, Math.min(0.25, median(baseline.pitch)));
                                    baseline.ready = true;
                                }
                            }
                            const turned = Math.abs(yaw - baseline.yaw0) > PROCTOR_CONFIG.HEAD_YAW_THRESHOLD
                                || Math.abs(pitch - baseline.pitch0) > PROCTOR_CONFIG.HEAD_PITCH_THRESHOLD;
                            if (signals.headPose.update(turned, now)) {
                                report('look_away', "Looking away detected — please keep your eyes on the screen.");
                            }

                            const shapes = results.faceBlendshapes?.[0]?.categories;
                            if (shapes && shapes.length > 0) {
                                const score = (name: string) => shapes.find(s => s.categoryName === name)?.score ?? 0;
                                const blinking = (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2 > 0.5;
                                // Both eyes the same way; looking down (keyboard, paper on the desk is caught by the
                                // object detector) is not counted, sideways and up are
                                const sideways = Math.max(
                                    (score('eyeLookOutLeft') + score('eyeLookInRight')) / 2,
                                    (score('eyeLookInLeft') + score('eyeLookOutRight')) / 2,
                                );
                                const up = (score('eyeLookUpLeft') + score('eyeLookUpRight')) / 2;
                                const away = !blinking && (sideways > PROCTOR_CONFIG.GAZE_SIDEWAYS_THRESHOLD || up > PROCTOR_CONFIG.GAZE_UP_THRESHOLD);
                                if (signals.gaze.update(away, now)) {
                                    report('eye_darting', "Eyes off the screen — please keep your eyes on the screen.");
                                }
                            }
                        } else {
                            signals.headPose.update(false, now);
                            signals.gaze.update(false, now);
                        }
                    } catch (err) {
                        // Suppress Wasm runtime errors
                    } finally {
                        isProcessing.current = false;
                        console.error = originalError;
                    }
                }
            }
            requestRef.current = requestAnimationFrame(processFrame);
        };

        requestRef.current = requestAnimationFrame(processFrame);
        return () => cancelAnimationFrame(requestRef.current);
    }, [sessionMode, role, videoRef]);

    // Camera health: covered or dark lens, frozen image (e.g. a still picture fed through a virtual
    // camera), and a camera track that ended, was muted by the OS, or disabled
    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') return;
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 24;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const dark = new SustainedSignal(3000, 0.8, 15000, 5);
        const frozen = new SustainedSignal(6000, 0.9, 20000, 10);
        let previous: Float32Array | null = null;
        let lastCurrentTime = -1;
        let cameraLostSince = 0;
        let cameraWasLive = false;
        let lastOffReport = 0;

        const tick = () => {
            const video = videoRef.current;
            const now = Date.now();
            const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
            const track = stream?.getVideoTracks()[0];
            const usable = Boolean(track && track.readyState === 'live' && track.enabled && !track.muted);
            if (usable) {
                cameraWasLive = true;
                cameraLostSince = 0;
            } else if (cameraWasLive) {
                // Only after the camera was working once: before that the exam start flow handles it
                if (!cameraLostSince) cameraLostSince = now;
                else if (now - cameraLostSince > PROCTOR_CONFIG.CAMERA_OFF_MS && now - lastOffReport > 30000) {
                    lastOffReport = now;
                    const why = !track ? 'no camera' : track.readyState === 'ended' ? 'the camera stopped' : track.muted ? 'the camera was blocked by the system' : 'the camera was turned off';
                    onViolationRef.current('camera_off', `Camera unavailable (${why}) — please turn your camera back on.`);
                }
            }
            if (!video || !ctx || !usable || video.readyState < 2 || video.videoWidth === 0) {
                previous = null;
                return;
            }
            try {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const luma = toLuma(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
                const problem = cameraFrameProblem(luma);
                if (dark.update(problem !== null, now)) {
                    onViolationRef.current('camera_dark', problem === 'dark'
                        ? 'Your camera image is too dark or covered — please uncover it or add light.'
                        : 'Your camera looks covered (blank image) — please uncover it.');
                }
                // Identical frames, or a video clock that stopped, for 6 s
                const stalled = video.currentTime === lastCurrentTime;
                lastCurrentTime = video.currentTime;
                const identical = previous ? lumaDifference(previous, luma) < CAMERA_HEALTH.FROZEN_DIFF : false;
                previous = luma;
                if (frozen.update(problem === null && (identical || stalled), now)) {
                    onViolationRef.current('camera_frozen', 'Your camera image is frozen — please check your camera.');
                }
            } catch {
                // A cross-origin or not-yet-ready frame: skip this sample
            }
        };
        const timer = setInterval(tick, PROCTOR_CONFIG.HEALTH_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [sessionMode, role, videoRef]);
}
