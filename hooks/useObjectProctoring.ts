import { useEffect, useRef } from 'react';
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { SustainedSignal } from '@/lib/proctoringPolicy';

// EfficientDet-Lite0 is trained on COCO: of the things that matter in an exam it knows "cell phone",
// "book", "laptop", "tv" (second screen) and "person". It has no headphones/earbuds class, so those
// cannot be detected from the camera.
const PROCTOR_CONFIG = {
    FRAME_INTERVAL_MS: 250,
    /** Per-class minimum confidence. Phones are small and often half hidden, so they get the lowest bar. */
    MIN_SCORE: { 'cell phone': 0.40, 'book': 0.50, 'laptop': 0.55, 'tv': 0.55, 'person': 0.55 } as Record<string, number>,
};

const OBJECT_MESSAGE: Record<string, string> = {
    phone: 'A phone was detected on camera — please put it away.',
    book: 'A book or notes were detected on camera — please put them away.',
    screen: 'A second screen or device was detected on camera — please remove it.',
    person: 'Another person was detected on camera — you must be alone during the exam.',
};

export function useObjectProctoring(
    videoRef: React.RefObject<HTMLVideoElement | null>,
    sessionMode: string | null,
    role: string | null,
    onViolation: (type: string, message: string) => void
) {
    // Callers pass an inline callback; keep the latest one in a ref so the detection loop is not
    // torn down and restarted on every render
    const onViolationRef = useRef(onViolation);
    onViolationRef.current = onViolation;

    const detectorRef = useRef<ObjectDetector | null>(null);
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
                const objectDetector = await ObjectDetector.createFromOptions(filesetResolver, {
                    baseOptions: {
                        modelAssetPath: "/models/efficientdet_lite0.tflite",
                        delegate: "GPU"
                    },
                    scoreThreshold: 0.35,
                    maxResults: 10,
                    categoryAllowlist: Object.keys(PROCTOR_CONFIG.MIN_SCORE),
                    runningMode: "VIDEO"
                });
                if (isMounted) detectorRef.current = objectDetector;
                else objectDetector.close();
            } catch (err) {
                console.warn("[ObjectProctoring] Failed to init ObjectDetector:", err);
            }
        }

        initModel();

        return () => {
            isMounted = false;
            if (detectorRef.current) {
                detectorRef.current.close();
                detectorRef.current = null;
            }
        };
    }, [sessionMode, role]);

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') return;

        // ~4 samples a second: an object must be seen in most of a 2 s window (a person in 3 s)
        const signals: Record<string, SustainedSignal> = {
            phone: new SustainedSignal(2000, 0.5, 10000, 4),
            book: new SustainedSignal(2000, 0.6, 10000, 4),
            screen: new SustainedSignal(2500, 0.6, 15000, 5),
            person: new SustainedSignal(3000, 0.6, 15000, 6),
        };
        let lastRun = 0;

        const processFrame = () => {
            const videoElement = videoRef.current;
            if (!detectorRef.current || isProcessing.current || !videoElement) {
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
                        if (msg.includes('index out of bounds') || msg.includes('abort') || msg.includes('wasm') || msg.includes('memory')) return;
                        originalError.apply(console, args);
                    };

                    try {
                        isProcessing.current = true;
                        const results = detectorRef.current.detectForVideo(videoElement, nowInMs);
                        const best: Record<string, number> = {};
                        let people = 0;
                        for (const detection of results.detections) {
                            const category = detection.categories[0];
                            if (!category) continue;
                            const name = category.categoryName;
                            if (category.score < (PROCTOR_CONFIG.MIN_SCORE[name] ?? 1)) continue;
                            if (name === 'person') people++;
                            best[name] = Math.max(best[name] || 0, category.score);
                        }
                        const seen: Record<string, number> = {
                            phone: best['cell phone'] || 0,
                            book: best['book'] || 0,
                            screen: Math.max(best['laptop'] || 0, best['tv'] || 0),
                            person: people >= 2 ? best['person'] : 0,
                        };
                        const now = Date.now();
                        for (const key of Object.keys(signals)) {
                            if (signals[key].update(seen[key] > 0, now)) {
                                const type = key === 'person' ? 'multiple_faces' : 'forbidden_object';
                                onViolationRef.current(type, `${OBJECT_MESSAGE[key]} (${Math.round(seen[key] * 100)}% confidence)`);
                            }
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
}
