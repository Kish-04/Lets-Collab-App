import { useEffect, useRef } from 'react';
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';

const PROCTOR_CONFIG = {
    FORBIDDEN_OBJECT_TIMEOUT_MS: 1000, 
};

export function useObjectProctoring(
    videoRef: React.RefObject<HTMLVideoElement | null>,
    sessionMode: string | null,
    role: string | null,
    onViolation: (type: string, message: string) => void
) {
    const detectorRef = useRef<ObjectDetector | null>(null);
    const requestRef = useRef<number>(0);
    const lastVideoTime = useRef(-1);
    const isProcessing = useRef(false);

    const violationState = useRef({
        phoneVisibleSince: 0,
    });

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
                    scoreThreshold: 0.3,
                    runningMode: "VIDEO"
                });
                if (isMounted) detectorRef.current = objectDetector;
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

        const processFrame = () => {
            const videoElement = videoRef.current;
            if (!detectorRef.current || isProcessing.current || !videoElement) {
                requestRef.current = requestAnimationFrame(processFrame);
                return;
            }

            if (videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
                const nowInMs = performance.now();
                if (videoElement.currentTime !== lastVideoTime.current) {
                    lastVideoTime.current = videoElement.currentTime;

                    const originalError = console.error;
                    console.error = (...args: any[]) => {
                        const msg = String(args[0] || '').toLowerCase();
                        if (msg.includes('index out of bounds') || msg.includes('abort') || msg.includes('wasm') || msg.includes('memory')) return;
                        originalError.apply(console, args);
                    };

                    try {
                        isProcessing.current = true;
                        const results = detectorRef.current.detectForVideo(videoElement, nowInMs);

                        const FORBIDDEN_OBJECTS = ['cell phone', 'book', 'laptop', 'tv', 'remote'];
                        let detectedForbiddenObject = '';
                        
                        for (const detection of results.detections) {
                            for (const category of detection.categories) {
                                if (FORBIDDEN_OBJECTS.includes(category.categoryName)) {
                                    detectedForbiddenObject = category.categoryName;
                                    break;
                                }
                            }
                            if (detectedForbiddenObject) break;
                        }

                        const state = violationState.current;
                        const now = Date.now();

                        if (detectedForbiddenObject) {
                            if (state.phoneVisibleSince === 0) state.phoneVisibleSince = now;
                            else if (now - state.phoneVisibleSince > PROCTOR_CONFIG.FORBIDDEN_OBJECT_TIMEOUT_MS) {
                                onViolation('forbidden_object', `Forbidden object detected: ${detectedForbiddenObject}. Please put away any unauthorized materials.`);
                                state.phoneVisibleSince = now + 5000; // Reset to avoid spam
                            }
                        } else {
                            if (now > state.phoneVisibleSince) {
                                state.phoneVisibleSince = 0;
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
    }, [sessionMode, role, videoRef, onViolation]);
}
