import { useEffect, useRef } from 'react';
import { acquireFaceTracker } from '@/lib/faceLandmarker';
import { acquireObjectDetector } from '@/lib/objectDetector';
import {
    AdaptiveInterval, CAMERA_HEALTH, OBJECT_MIN_SCORE, SustainedSignal, cameraFrameProblem, classifyObjects,
    lumaDifference, toLuma, type CameraFrameProblem,
} from '@/lib/proctoringPolicy';

// The supervised-exam camera pipeline: ONE loop over the candidate's camera that runs
//   - face analysis (shared MediaPipe Face Landmarker): no face, face hidden, other faces, head pose,
//     gaze, framing
//   - object detection (shared MediaPipe ObjectDetector, EfficientDet-Lite0 / COCO): phone, book,
//     second screen, other people
//   - camera health on a 32x24 thumbnail: covered, too dark, frozen, turned off
// Each job runs in its own task (never two models back to back), at a rate that slows down when this
// device is slow (AdaptiveInterval). Every check needs its condition over most of a short window
// (SustainedSignal), so one bad frame, a blink or a quick glance never raises an alarm.
const CONFIG = {
    /** Face analysis: 10 per second, down to 2.5 per second on a slow device */
    FACE_INTERVAL_MS: 100,
    FACE_MAX_INTERVAL_MS: 400,
    FACE_BUDGET_MS: 30,
    /** Object detection: 2.5 per second, down to 1 per second */
    OBJECT_INTERVAL_MS: 400,
    OBJECT_MAX_INTERVAL_MS: 1000,
    OBJECT_BUDGET_MS: 40,
    /** Camera health sampling (thumbnail luma) */
    HEALTH_INTERVAL_MS: 500,
    /** Head pose relative to the candidate's own resting pose (measured over the first frames) */
    HEAD_YAW_THRESHOLD: 0.33,   // rad, ~19 degrees left/right
    HEAD_PITCH_THRESHOLD: 0.30, // rad, ~17 degrees up/down
    BASELINE_FRAMES: 30,
    /** Horizontal gaze from the eyeLookIn/Out blendshapes (both eyes the same way) */
    GAZE_SIDEWAYS_THRESHOLD: 0.55,
    GAZE_UP_THRESHOLD: 0.65,
    /** Face narrower than this fraction of the frame is too far away */
    MIN_FACE_WIDTH: 0.12,
    /** No usable camera track (ended, muted by the OS/privacy switch, disabled) for this long */
    CAMERA_OFF_MS: 10000,
    /** A person seen by the object detector this recently counts as "someone is in front of the camera" */
    PERSON_RECENT_MS: 2500,
};

export interface CameraProctoringOptions {
    /** The host's AI calibration may make the gaze check stricter (0-1, lower is stricter), never laxer */
    gazeThreshold?: number;
    /** Canvas over the candidate's own preview: the tracked face and flagged objects are outlined on it */
    overlayRef?: React.RefObject<HTMLCanvasElement | null>;
}

type Box = { x: number; y: number; w: number; h: number; label: string };

const OBJECT_LABEL: Record<string, string> = { 'cell phone': 'Phone', book: 'Book', laptop: 'Laptop', tv: 'Screen', person: 'Person' };

export function useFaceProctoring(
    videoRef: React.RefObject<HTMLVideoElement | null>,
    sessionMode: string | null,
    role: string | null,
    onViolation: (type: string, message: string) => void,
    options: CameraProctoringOptions = {},
) {
    // Callers pass an inline callback and options; keep the latest in refs so the loop is not
    // torn down and restarted on every render
    const onViolationRef = useRef(onViolation);
    onViolationRef.current = onViolation;
    const optionsRef = useRef(options);
    optionsRef.current = options;

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') return;

        // Proctoring counts people, so it asks for up to 3 faces and accepts a half-visible face
        const face = acquireFaceTracker({ numFaces: 3, minConfidence: 0.4 });
        const objects = acquireObjectDetector();
        let objectsReady = false;
        face.ready.catch(err => console.warn('[CameraProctoring] Face tracking unavailable:', err));
        objects.ready.then(() => { objectsReady = true; }, err => console.warn('[CameraProctoring] Object detection unavailable:', err));

        const report = (type: string, message: string) => onViolationRef.current(type, message);
        const signals = {
            noFace: new SustainedSignal(2500, 0.85),
            faceBlocked: new SustainedSignal(3000, 0.8),
            multipleFaces: new SustainedSignal(1500, 0.6),
            headPose: new SustainedSignal(1500, 0.75),
            gaze: new SustainedSignal(2000, 0.8),
            outOfFrame: new SustainedSignal(4000, 0.8, 15000),
            // Objects are sampled 1-2.5 times a second: seen in most of a 3 s window, at least 3 samples
            phone: new SustainedSignal(3000, 0.5, 10000, 3),
            book: new SustainedSignal(3000, 0.6, 10000, 3),
            screen: new SustainedSignal(3000, 0.6, 15000, 3),
            people: new SustainedSignal(3000, 0.6, 15000, 3),
            // Camera health every 500 ms
            covered: new SustainedSignal(3000, 0.8, 15000, 5),
            dark: new SustainedSignal(3000, 0.8, 15000, 5),
            frozen: new SustainedSignal(6000, 0.9, 20000, 10),
        };
        const baseline = { yaw: [] as number[], pitch: [] as number[], yaw0: 0, pitch0: 0, ready: false };
        const health = { problem: null as CameraFrameProblem | null, frozen: false, usable: false };
        let personSeenAt = 0;
        let faceSeenAt = 0;
        let faceBox: Box | null = null;
        let objectBoxes: Box[] = [];

        // ── Overlay ──────────────────────────────────────────────────────────────────────────────
        const drawOverlay = (video: HTMLVideoElement) => {
            const canvas = optionsRef.current.overlayRef?.current;
            const ctx = canvas?.getContext('2d');
            if (!canvas || !ctx) return;
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
            }
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.lineWidth = 2;
            ctx.font = '600 14px system-ui, sans-serif';
            const draw = (box: Box, color: string) => {
                ctx.strokeStyle = color;
                ctx.strokeRect(box.x * canvas.width, box.y * canvas.height, box.w * canvas.width, box.h * canvas.height);
                if (box.label) {
                    ctx.fillStyle = color;
                    ctx.fillText(box.label, box.x * canvas.width + 4, Math.max(14, box.y * canvas.height - 4));
                }
            };
            if (faceBox) draw(faceBox, 'rgba(0, 255, 127, 0.75)');
            objectBoxes.forEach(box => draw(box, 'rgba(255, 70, 70, 0.9)'));
        };
        const clearOverlay = () => {
            const canvas = optionsRef.current.overlayRef?.current;
            canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        };

        // ── Face ─────────────────────────────────────────────────────────────────────────────────
        const faceRate = new AdaptiveInterval(CONFIG.FACE_INTERVAL_MS, CONFIG.FACE_MAX_INTERVAL_MS, CONFIG.FACE_BUDGET_MS);
        const runFace = (video: HTMLVideoElement): number => {
            const results = face.detect(video);
            if (!results) return faceRate.current;
            const interval = faceRate.record(face.lastCostMs());
            const now = Date.now();
            const numFaces = results.faceLandmarks ? results.faceLandmarks.length : 0;
            // The object detector still sees a person: the face is covered (hand, object) or turned away
            const personInView = objectsReady && now - personSeenAt < CONFIG.PERSON_RECENT_MS;
            // A covered, frozen or switched-off camera (or one too dark to even see a person) is
            // reported as such, not as a missing face
            const tooDark = health.problem === 'dark' && !personInView;
            const cameraProblem = !health.usable || health.problem === 'covered' || tooDark || health.frozen;
            const noFace = numFaces === 0 && !cameraProblem;

            if (signals.noFace.update(noFace && !personInView, now)) {
                report('no_face', 'No face detected — please sit in front of the camera and face the screen.');
            }
            if (signals.faceBlocked.update(noFace && personInView, now)) {
                report('face_blocked', 'Your face is not visible although you are in view — something is covering it or you turned away. Please keep your face visible.');
            }
            if (signals.multipleFaces.update(numFaces > 1, now)) {
                report('multiple_faces', `${numFaces} faces detected — you must be alone during the exam.`);
            }

            faceBox = null;
            if (numFaces >= 1) {
                faceSeenAt = now;
                const marks = results.faceLandmarks[0];
                let minX = 1, maxX = 0, minY = 1, maxY = 0;
                for (const m of marks) {
                    if (m.x < minX) minX = m.x;
                    if (m.x > maxX) maxX = m.x;
                    if (m.y < minY) minY = m.y;
                    if (m.y > maxY) maxY = m.y;
                }
                faceBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY, label: '' };
                const tooFar = maxX - minX < CONFIG.MIN_FACE_WIDTH;
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

                // The camera is rarely straight in front of the candidate: measure their resting pose
                // first and judge turns relative to it (capped so a turned start is not "normal")
                if (!baseline.ready) {
                    baseline.yaw.push(yaw);
                    baseline.pitch.push(pitch);
                    if (baseline.yaw.length >= CONFIG.BASELINE_FRAMES) {
                        const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
                        baseline.yaw0 = Math.max(-0.25, Math.min(0.25, median(baseline.yaw)));
                        baseline.pitch0 = Math.max(-0.25, Math.min(0.25, median(baseline.pitch)));
                        baseline.ready = true;
                    }
                }
                const turned = Math.abs(yaw - baseline.yaw0) > CONFIG.HEAD_YAW_THRESHOLD
                    || Math.abs(pitch - baseline.pitch0) > CONFIG.HEAD_PITCH_THRESHOLD;
                if (signals.headPose.update(turned, now)) {
                    report('look_away', 'Looking away detected — please keep your eyes on the screen.');
                }

                const shapes = results.faceBlendshapes?.[0]?.categories;
                if (shapes && shapes.length > 0) {
                    const score = (name: string) => shapes.find(s => s.categoryName === name)?.score ?? 0;
                    const blinking = (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2 > 0.5;
                    // Both eyes the same way; looking down (keyboard; paper on the desk is caught by the
                    // object detector) is not counted, sideways and up are
                    const sideways = Math.max(
                        (score('eyeLookOutLeft') + score('eyeLookInRight')) / 2,
                        (score('eyeLookInLeft') + score('eyeLookOutRight')) / 2,
                    );
                    const up = (score('eyeLookUpLeft') + score('eyeLookUpRight')) / 2;
                    const hostThreshold = optionsRef.current.gazeThreshold;
                    const sidewaysThreshold = Math.min(CONFIG.GAZE_SIDEWAYS_THRESHOLD, Number.isFinite(hostThreshold) && hostThreshold! > 0 ? hostThreshold! : 1);
                    const away = !blinking && (sideways > sidewaysThreshold || up > CONFIG.GAZE_UP_THRESHOLD);
                    if (signals.gaze.update(away, now)) {
                        report('eye_darting', 'Eyes off the screen — please keep your eyes on the screen.');
                    }
                }
            } else {
                signals.headPose.update(false, now);
                signals.gaze.update(false, now);
            }
            drawOverlay(video);
            return interval;
        };

        // ── Objects ──────────────────────────────────────────────────────────────────────────────
        const objectRate = new AdaptiveInterval(CONFIG.OBJECT_INTERVAL_MS, CONFIG.OBJECT_MAX_INTERVAL_MS, CONFIG.OBJECT_BUDGET_MS);
        const runObjects = (video: HTMLVideoElement): number => {
            const results = objects.detect(video);
            if (!results) return objectRate.current;
            const interval = objectRate.record(objects.lastCostMs());
            const now = Date.now();
            const seen = classifyObjects(results.detections);
            if (seen.people > 0) personSeenAt = now;

            // Boxes are in pixels of the (possibly scaled-down) model input
            const inputWidth = Math.min(video.videoWidth, 480);
            const inputHeight = video.videoHeight * (inputWidth / video.videoWidth);
            objectBoxes = [];
            for (const detection of results.detections) {
                const category = detection.categories?.[0];
                const box = detection.boundingBox;
                if (!category || !box || category.categoryName === 'person') continue;
                if (category.score < (OBJECT_MIN_SCORE[category.categoryName] ?? 1)) continue;
                objectBoxes.push({
                    x: box.originX / inputWidth, y: box.originY / inputHeight,
                    w: box.width / inputWidth, h: box.height / inputHeight,
                    label: `${OBJECT_LABEL[category.categoryName] || category.categoryName} ${Math.round(category.score * 100)}%`,
                });
            }

            const pct = (score: number) => `${Math.round(score * 100)}% confidence`;
            if (signals.phone.update(seen.phone > 0, now)) {
                report('phone_detected', `A phone is visible in your camera (${pct(seen.phone)}) — please put it away.`);
            }
            if (signals.book.update(seen.book > 0, now)) {
                report('book_detected', `A book or notes are visible in your camera (${pct(seen.book)}) — please put them away.`);
            }
            if (signals.screen.update(seen.screen > 0, now)) {
                report('screen_detected', `Another screen or laptop is visible in your camera (${pct(seen.screen)}) — please remove it.`);
            }
            // A second person can be in view without showing their face (behind or beside the candidate)
            if (signals.people.update(seen.people >= 2, now)) {
                report('multiple_faces', `${seen.people} people are visible in your camera — you must be alone during the exam.`);
            }
            return interval;
        };

        // ── Camera health: covered lens, darkness, a frozen image (e.g. a still picture fed through
        // a virtual camera), and a camera track that ended, was muted by the OS, or disabled ──────
        const thumb = document.createElement('canvas');
        thumb.width = 32;
        thumb.height = 24;
        const thumbCtx = thumb.getContext('2d', { willReadFrequently: true });
        let previous: Float32Array | null = null;
        let lastCurrentTime = -1;
        let cameraLostSince = 0;
        let cameraWasLive = false;
        let lastOffReport = 0;
        const runHealth = (video: HTMLVideoElement | null): number => {
            const now = Date.now();
            const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
            const track = stream?.getVideoTracks()[0];
            const usable = Boolean(track && track.readyState === 'live' && track.enabled && !track.muted);
            health.usable = usable;
            if (usable) {
                cameraWasLive = true;
                cameraLostSince = 0;
            } else if (cameraWasLive) {
                // Only after the camera was working once: before that the exam start flow handles it
                if (!cameraLostSince) cameraLostSince = now;
                else if (now - cameraLostSince > CONFIG.CAMERA_OFF_MS && now - lastOffReport > 30000) {
                    lastOffReport = now;
                    const why = !track ? 'no camera' : track.readyState === 'ended' ? 'the camera stopped' : track.muted ? 'the camera was blocked by the system' : 'the camera was turned off';
                    report('camera_off', `Camera turned off (${why}) — please turn your camera back on.`);
                }
            }
            if (!video || !thumbCtx || !usable || video.readyState < 2 || video.videoWidth === 0) {
                previous = null;
                health.problem = null;
                health.frozen = false;
                return CONFIG.HEALTH_INTERVAL_MS;
            }
            try {
                thumbCtx.drawImage(video, 0, 0, thumb.width, thumb.height);
                const luma = toLuma(thumbCtx.getImageData(0, 0, thumb.width, thumb.height).data);
                const problem = cameraFrameProblem(luma);
                health.problem = problem;
                if (signals.covered.update(problem === 'covered', now)) {
                    report('camera_covered', 'Your camera looks blocked or covered — please uncover it.');
                }
                // A dim picture in which the face or the person is still found (e.g. a dark wall behind
                // the candidate) can be proctored, so "too dark" only counts while neither is
                const visible = now - faceSeenAt < 2000 || (objectsReady && now - personSeenAt < CONFIG.PERSON_RECENT_MS);
                if (signals.dark.update(problem === 'dark' && !visible, now)) {
                    report('camera_dark', 'Your camera image is too dark — please turn on a light or face a window.');
                }
                // Identical frames, or a video clock that stopped, for 6 s
                const stalled = video.currentTime === lastCurrentTime;
                lastCurrentTime = video.currentTime;
                const identical = previous ? lumaDifference(previous, luma) < CAMERA_HEALTH.FROZEN_DIFF : false;
                previous = luma;
                health.frozen = problem === null && (identical || stalled);
                if (signals.frozen.update(health.frozen, now)) {
                    report('camera_frozen', 'Your camera image is frozen — please check your camera.');
                }
            } catch {
                // A cross-origin or not-yet-ready frame: skip this sample
            }
            return CONFIG.HEALTH_INTERVAL_MS;
        };

        // ── Scheduler: one job per task, the most overdue first ──────────────────────────────────
        const start = performance.now();
        const jobs = [
            { next: start, run: (video: HTMLVideoElement | null) => runHealth(video) },
            { next: start + 50, run: (video: HTMLVideoElement | null) => video ? runFace(video) : CONFIG.FACE_INTERVAL_MS },
            { next: start + 200, run: (video: HTMLVideoElement | null) => video ? runObjects(video) : CONFIG.OBJECT_INTERVAL_MS },
        ];
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const loop = () => {
            if (stopped) return;
            const now = performance.now();
            let due: typeof jobs[number] | null = null;
            for (const job of jobs) if (job.next <= now && (!due || job.next < due.next)) due = job;
            if (due) {
                const video = videoRef.current;
                const ready = video && video.readyState >= 2 && video.videoWidth > 0 ? video : null;
                let interval = 250;
                try {
                    interval = due === jobs[0] ? due.run(video) : due.run(ready);
                } catch (err) {
                    console.warn('[CameraProctoring] Check failed:', err);
                }
                due.next = performance.now() + interval;
            }
            const wait = Math.max(4, Math.min(...jobs.map(job => job.next)) - performance.now());
            timer = setTimeout(loop, wait);
        };
        timer = setTimeout(loop, 0);

        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            face.release();
            objects.release();
            clearOverlay();
        };
    }, [sessionMode, role, videoRef]);
}
