import type { ObjectDetector, ObjectDetectorResult } from '@mediapipe/tasks-vision'
import { OBJECT_MIN_SCORE } from './proctoringPolicy'
import { SharedVisionTask, type VisionTaskHandle } from './visionTask'

// The one on-device object detector of the page: MediaPipe ObjectDetector with EfficientDet-Lite0
// (COCO classes; /models/efficientdet_lite0.tflite, local). Only the classes the exam policy uses are
// returned; lib/proctoringPolicy.ts (classifyObjects) applies the per-class thresholds.
const shared = new SharedVisionTask<ObjectDetector, ObjectDetectorResult, null>({
    name: 'objectDetector',
    async create(fileset, delegate) {
        const { ObjectDetector } = await import('@mediapipe/tasks-vision')
        return ObjectDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/models/efficientdet_lite0.tflite', delegate },
            // Below every per-class bar, so the policy (not the model) decides
            scoreThreshold: Math.min(...Object.values(OBJECT_MIN_SCORE)) - 0.05,
            maxResults: 10,
            categoryAllowlist: Object.keys(OBJECT_MIN_SCORE),
            runningMode: 'VIDEO',
        })
    },
    run: (task, input, timestamp) => task.detectForVideo(input, timestamp),
    merge: () => null,
    sameNeed: () => true,
    // EfficientDet-Lite0 takes a 320x320 input; a slightly larger frame keeps small phones sharp
    maxInputWidth: 480,
})

export type ObjectTracker = VisionTaskHandle<ObjectDetectorResult>

export function acquireObjectDetector(): ObjectTracker {
    return shared.acquire(null)
}
