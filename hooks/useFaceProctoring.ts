import { useEffect, useRef } from 'react';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

const PROCTOR_CONFIG = {
    NO_FACE_TIMEOUT_MS: 2000,
    MULTIPLE_FACES_TIMEOUT_MS: 2000,
    LOOK_AWAY_TIMEOUT_MS: 2000,
    HEAD_YAW_THRESHOLD: 0.35, 
    HEAD_PITCH_THRESHOLD: 0.30,
    EYE_DART_TIMEOUT_MS: 1000,
};

export function useFaceProctoring(
    videoRef: React.RefObject<HTMLVideoElement | null>,
    sessionMode: string | null,
    role: string | null,
    onViolation: (type: string, message: string) => void
) {
    const landmarkerRef = useRef<FaceLandmarker | null>(null);
    const requestRef = useRef<number>(0);
    const lastVideoTime = useRef(-1);
    const isProcessing = useRef(false);

    const violationState = useRef({
        noFaceSince: 0,
        multipleFacesSince: 0,
        lookAwaySince: 0,
        eyeDartSince: 0,
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
                const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
                    baseOptions: {
                        modelAssetPath: "/models/face_landmarker.task",
                        delegate: "GPU"
                    },
                    outputFaceBlendshapes: true,
                    outputFacialTransformationMatrixes: true,
                    runningMode: "VIDEO",
                    numFaces: 5
                });
                if (isMounted) landmarkerRef.current = faceLandmarker;
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

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') return;

        const processFrame = () => {
            const videoElement = videoRef.current;
            if (!landmarkerRef.current || isProcessing.current || !videoElement) {
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
                        if (msg.includes('index out of bounds') || msg.includes('abort') || msg.includes('wasm') || msg.includes('memory')) {
                            return;
                        }
                        originalError.apply(console, args);
                    };

                    try {
                        isProcessing.current = true;
                        const results = landmarkerRef.current.detectForVideo(videoElement, nowInMs);

                        const numFaces = results.faceLandmarks ? results.faceLandmarks.length : 0;
                        const state = violationState.current;
                        const now = Date.now();

                        if (numFaces === 0) {
                            if (state.noFaceSince === 0) state.noFaceSince = now;
                            else if (now - state.noFaceSince > PROCTOR_CONFIG.NO_FACE_TIMEOUT_MS) {
                                onViolation('no_face', "Please make sure you're in front of the camera and facing the screen.");
                                state.noFaceSince = now;
                            }
                        } else {
                            state.noFaceSince = 0;
                        }

                        if (numFaces > 1) {
                            if (state.multipleFacesSince === 0) state.multipleFacesSince = now;
                            else if (now - state.multipleFacesSince > PROCTOR_CONFIG.MULTIPLE_FACES_TIMEOUT_MS) {
                                onViolation('multiple_faces', "Multiple faces detected. Please make sure you're alone.");
                                state.multipleFacesSince = now;
                            }
                        } else {
                            state.multipleFacesSince = 0;
                        }

                        if (numFaces === 1 && results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
                            const matrix = results.facialTransformationMatrixes[0].data;
                            const yaw = Math.atan2(matrix[8], matrix[10]);
                            const pitch = Math.asin(-matrix[9]);

                            if (Math.abs(yaw) > PROCTOR_CONFIG.HEAD_YAW_THRESHOLD || Math.abs(pitch) > PROCTOR_CONFIG.HEAD_PITCH_THRESHOLD) {
                                if (state.lookAwaySince === 0) state.lookAwaySince = now;
                                else if (now - state.lookAwaySince > PROCTOR_CONFIG.LOOK_AWAY_TIMEOUT_MS) {
                                    onViolation('look_away', "Please make sure you're facing the screen directly.");
                                    state.lookAwaySince = now;
                                }
                            } else {
                                state.lookAwaySince = 0;
                            }
                            
                            // Advanced Gaze Tracking using Blendshapes
                            if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
                                const blendshapes = results.faceBlendshapes[0].categories;
                                let isDartingEyes = false;
                                
                                for (const shape of blendshapes) {
                                    if (shape.categoryName.startsWith('eyeLook')) {
                                        // Lowered threshold to 0.35 to be much more sensitive
                                        if (shape.score > 0.35) {
                                            isDartingEyes = true;
                                        }
                                    }
                                }
                                
                                if (isDartingEyes) {
                                    if (state.eyeDartSince === 0) state.eyeDartSince = now;
                                    else if (now - state.eyeDartSince > PROCTOR_CONFIG.EYE_DART_TIMEOUT_MS) {
                                        onViolation('eye_darting', "Suspicious eye movement detected. Please keep your eyes on the screen.");
                                        state.eyeDartSince = now + 5000; // Reset to avoid spam
                                    }
                                } else {
                                    if (now > state.eyeDartSince) {
                                        state.eyeDartSince = 0;
                                    }
                                }
                                }
                        } else {
                            state.lookAwaySince = 0;
                            state.eyeDartSince = 0;
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
