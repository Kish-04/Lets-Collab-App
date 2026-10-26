import type { FaceLandmarker } from '@mediapipe/tasks-vision'

// One on-device MediaPipe face landmarker (local /wasm + /models assets) shared by the 3D avatars
// and the custom image avatar. Only one of them runs at a time, so they can share the instance;
// it is closed once the last user releases it.
let instance: Promise<FaceLandmarker> | null = null
let users = 0
let lastTimestamp = 0

async function create(): Promise<FaceLandmarker> {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks('/wasm')
    const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: 'VIDEO' as const,
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
    })
    try {
        return await FaceLandmarker.createFromOptions(fileset, options('GPU'))
    } catch (err) {
        console.warn('[faceLandmarker] GPU delegate unavailable, falling back to CPU.', err)
        return FaceLandmarker.createFromOptions(fileset, options('CPU'))
    }
}

export function acquireFaceLandmarker(): Promise<FaceLandmarker> {
    users += 1
    if (!instance) {
        instance = create()
        instance.catch(() => { instance = null })
    }
    return instance
}

export function releaseFaceLandmarker() {
    users = Math.max(0, users - 1)
    if (users > 0 || !instance) return
    const pending = instance
    instance = null
    pending.then(l => l.close()).catch(() => { })
}

// detectForVideo needs strictly increasing timestamps across every caller of the shared instance
export function nextFaceTimestamp() {
    lastTimestamp = Math.max(lastTimestamp + 1, Math.floor(performance.now()))
    return lastTimestamp
}
