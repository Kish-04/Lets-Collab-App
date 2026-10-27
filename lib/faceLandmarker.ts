import type { FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { SharedVisionTask, type VisionTaskHandle } from './visionTask'

// The one MediaPipe face landmarker of the page (local /wasm + /models assets), shared by the 3D
// avatars, the custom image avatar, supervised-exam proctoring and its calibration. Each holder states
// what it needs; the instance runs with the most demanding combination (most faces, lowest confidence).
export interface FaceNeed {
    /** How many faces to look for (proctoring counts people, the avatars only follow one) */
    numFaces: number
    /** Lowest detection/presence confidence that counts as a face */
    minConfidence: number
}

const AVATAR_NEED: FaceNeed = { numFaces: 1, minConfidence: 0.5 }

const options = (need: FaceNeed) => ({
    numFaces: need.numFaces,
    minFaceDetectionConfidence: need.minConfidence,
    minFacePresenceConfidence: need.minConfidence,
    minTrackingConfidence: 0.5,
})

const shared = new SharedVisionTask<FaceLandmarker, FaceLandmarkerResult, FaceNeed>({
    name: 'faceLandmarker',
    async create(fileset, delegate, need) {
        const { FaceLandmarker } = await import('@mediapipe/tasks-vision')
        return FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: 'VIDEO',
            ...options(need),
        })
    },
    run: (task, input, timestamp) => task.detectForVideo(input, timestamp),
    merge: (needs) => needs.length === 0 ? AVATAR_NEED : {
        numFaces: Math.max(...needs.map(n => n.numFaces)),
        minConfidence: Math.min(...needs.map(n => n.minConfidence)),
    },
    sameNeed: (a, b) => a.numFaces === b.numFaces && a.minConfidence === b.minConfidence,
    reconfigure: (task, need) => task.setOptions(options(need)),
    // The face detector works on 128x128 and the landmark model on a 192x192 crop
    maxInputWidth: 640,
})

export type FaceTracker = VisionTaskHandle<FaceLandmarkerResult>

export function acquireFaceTracker(need: FaceNeed = AVATAR_NEED): FaceTracker {
    return shared.acquire(need)
}
