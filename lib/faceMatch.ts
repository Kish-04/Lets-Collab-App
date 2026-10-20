// On-device face recognition for identity checks (enrolment on the profile page, check at exam start).
// The camera image never leaves the device: face-api turns the face into a 128-number descriptor,
// and only that descriptor is sent to the server, which compares it with the enrolled one.
// Models are served from /models/face-api (tiny face detector, 68-point landmarks, recognition net).

const MODEL_URL = '/models/face-api'

// Euclidean distance between descriptors of the same person is usually below 0.4; 0.6 is the library's
// loose default. 0.5 trades a few retries for fewer false accepts. Keep in sync with server/faceRoutes.js.
export const FACE_MATCH_THRESHOLD = 0.5
export const DESCRIPTOR_LENGTH = 128

let loading: Promise<any> | null = null

async function loadFaceApi() {
    if (!loading) {
        loading = (async () => {
            const faceapi: any = await import('@vladmandic/face-api')
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
            ])
            return faceapi
        })().catch((err) => {
            loading = null // allow a retry after a network error
            throw err
        })
    }
    return loading
}

export type FaceSample = { descriptor: number[] } | { error: 'no_face' | 'multiple_faces' | 'not_ready' }

/** One descriptor from the current video frame, or why there is none. */
export async function describeFace(video: HTMLVideoElement): Promise<FaceSample> {
    if (!video || video.readyState < 2 || !video.videoWidth) return { error: 'not_ready' }
    const faceapi = await loadFaceApi()
    const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptors()
    if (detections.length === 0) return { error: 'no_face' }
    if (detections.length > 1) return { error: 'multiple_faces' }
    return { descriptor: Array.from(detections[0].descriptor as Float32Array) }
}

/** Averages a few frames for a steadier descriptor; fails if any frame has no face or several faces. */
export async function describeFaceSteadily(video: HTMLVideoElement, samples = 3, gapMs = 350): Promise<FaceSample> {
    const collected: number[][] = []
    for (let i = 0; i < samples; i++) {
        const sample = await describeFace(video)
        if ('error' in sample) return sample
        collected.push(sample.descriptor)
        if (i < samples - 1) await new Promise(resolve => setTimeout(resolve, gapMs))
    }
    const mean = new Array(DESCRIPTOR_LENGTH).fill(0)
    collected.forEach(d => d.forEach((v, j) => { mean[j] += v / collected.length }))
    return { descriptor: mean }
}

export function faceDistance(a: ArrayLike<number>, b: ArrayLike<number>) {
    let sum = 0
    for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
    return Math.sqrt(sum)
}

export const FACE_ERROR_TEXT: Record<'no_face' | 'multiple_faces' | 'not_ready', string> = {
    no_face: 'No face found. Face the camera in good light.',
    multiple_faces: 'More than one face is visible. Make sure you are alone in the frame.',
    not_ready: 'The camera is not ready yet.',
}
