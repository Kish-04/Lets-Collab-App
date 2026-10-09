import { Directory, File, Paths } from 'expo-file-system';

/**
 * Same MediaPipe face model the web proctoring engine loads (lib/AntiCheatEngine.ts), plus the
 * MediaPipe EfficientDet-Lite0 COCO detector (the web uses coco-ssd, same COCO "cell phone" label).
 * Models are downloaded once and cached on the device. Only model files are downloaded; no camera
 * data is ever uploaded.
 */
export const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
export const OBJECT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

const MIN_MODEL_BYTES = 100 * 1024;

async function ensureModel(url: string, fileName: string): Promise<string> {
  const dir = new Directory(Paths.document, 'proctoring-models');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

  const target = new File(dir, fileName);
  if (target.exists && (target.size ?? 0) >= MIN_MODEL_BYTES) return target.uri;

  // Download next to the target and move into place, so an interrupted download is never used.
  const partial = new File(dir, `${fileName}.download`);
  if (partial.exists) partial.delete();
  const downloaded = await File.downloadFileAsync(url, partial, { idempotent: true });
  if ((downloaded.size ?? 0) < MIN_MODEL_BYTES) {
    downloaded.delete();
    throw new Error(`Downloaded model ${fileName} is incomplete`);
  }
  await downloaded.move(target, { overwrite: true });
  return target.uri;
}

export type ProctoringModels = { face: string; object: string | null; objectError?: string };

/** The face model is required; phone detection degrades gracefully if its model is unavailable. */
export async function ensureProctoringModels(): Promise<ProctoringModels> {
  const [face, object] = await Promise.allSettled([
    ensureModel(FACE_MODEL_URL, 'face_landmarker.task'),
    ensureModel(OBJECT_MODEL_URL, 'efficientdet_lite0.tflite'),
  ]);
  if (face.status === 'rejected') {
    throw new Error(`Face model unavailable: ${face.reason?.message || face.reason}`);
  }
  return {
    face: face.value,
    object: object.status === 'fulfilled' ? object.value : null,
    objectError: object.status === 'rejected' ? String(object.reason?.message || object.reason) : undefined,
  };
}
