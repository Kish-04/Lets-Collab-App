package expo.modules.lcproctoring

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector
import org.webrtc.VideoFrame
import java.io.File
import java.io.RandomAccessFile
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.abs

/**
 * Runs the same models as the web proctoring engine (lib/AntiCheatEngine.ts):
 *  - MediaPipe FaceLandmarker (face_landmarker.task, up to 3 faces, blendshapes)
 *  - MediaPipe ObjectDetector with EfficientDet-Lite0 (COCO labels, includes "cell phone")
 * Not thread-safe: only call from the module's single inference thread.
 */
class FrameAnalyzer(context: Context, faceModelPath: String, objectModelPath: String?) {
  private val faceLandmarker: FaceLandmarker
  private val objectDetector: ObjectDetector?

  val hasObjectDetector: Boolean get() = objectDetector != null

  init {
    val faceOptions = FaceLandmarker.FaceLandmarkerOptions.builder()
      .setBaseOptions(
        BaseOptions.builder().setModelAssetBuffer(mapFile(faceModelPath)).setDelegate(Delegate.CPU).build()
      )
      .setRunningMode(RunningMode.IMAGE)
      .setNumFaces(3)
      .setOutputFaceBlendshapes(true)
      .build()
    faceLandmarker = FaceLandmarker.createFromOptions(context, faceOptions)

    objectDetector = objectModelPath?.let { path ->
      val options = ObjectDetector.ObjectDetectorOptions.builder()
        .setBaseOptions(BaseOptions.builder().setModelAssetBuffer(mapFile(path)).setDelegate(Delegate.CPU).build())
        .setRunningMode(RunningMode.IMAGE)
        .setScoreThreshold(0.5f)
        .setMaxResults(5)
        .build()
      ObjectDetector.createFromOptions(context, options)
    }
  }

  fun analyze(i420: VideoFrame.I420Buffer, rotation: Int): Map<String, Any?> {
    val bitmap = toUprightBitmap(i420, rotation)
    try {
      val image = BitmapImageBuilder(bitmap).build()

      val faces = faceLandmarker.detect(image)
      val landmarks = faces.faceLandmarks()
      var headOffset: Double? = null
      var maxEyeLook = 0.0
      if (landmarks.isNotEmpty()) {
        val marks = landmarks[0]
        if (marks.size > 263) {
          // Same metric as the web: nose tip (1) offset from the eye-corner midpoint (33, 263), in eye widths.
          val eyeWidth = abs(marks[263].x() - marks[33].x())
          if (eyeWidth > 1e-4f) {
            headOffset = (abs(marks[1].x() - (marks[33].x() + marks[263].x()) / 2f) / eyeWidth).toDouble()
          }
        }
        val blendshapes = faces.faceBlendshapes()
        if (blendshapes.isPresent && blendshapes.get().isNotEmpty()) {
          for (category in blendshapes.get()[0]) {
            if (category.categoryName().startsWith("eyeLook")) {
              maxEyeLook = maxOf(maxEyeLook, category.score().toDouble())
            }
          }
        }
      }

      val objects = ArrayList<Map<String, Any?>>()
      objectDetector?.detect(image)?.detections()?.forEach { detection ->
        val top = detection.categories().maxByOrNull { it.score() } ?: return@forEach
        objects.add(mapOf("label" to top.categoryName(), "score" to top.score().toDouble()))
      }

      return mapOf(
        "timestamp" to System.currentTimeMillis().toDouble(),
        "width" to bitmap.width,
        "height" to bitmap.height,
        "faceCount" to landmarks.size,
        "headOffset" to headOffset,
        "maxEyeLook" to maxEyeLook,
        "objectDetection" to (objectDetector != null),
        "objects" to objects,
      )
    } finally {
      bitmap.recycle()
    }
  }

  fun close() {
    try { faceLandmarker.close() } catch (_: Throwable) {}
    try { objectDetector?.close() } catch (_: Throwable) {}
  }

  private fun mapFile(path: String): MappedByteBuffer {
    val file = File(path)
    require(file.exists()) { "Model file not found: $path" }
    RandomAccessFile(file, "r").use { raf ->
      return raf.channel.map(FileChannel.MapMode.READ_ONLY, 0, raf.length())
    }
  }

  /** BT.601 full-range I420 -> ARGB_8888, then rotated upright (VideoFrame.rotation is clockwise degrees). */
  private fun toUprightBitmap(buffer: VideoFrame.I420Buffer, rotation: Int): Bitmap {
    val width = buffer.width
    val height = buffer.height
    val dataY = buffer.dataY
    val dataU = buffer.dataU
    val dataV = buffer.dataV
    val strideY = buffer.strideY
    val strideU = buffer.strideU
    val strideV = buffer.strideV
    val pixels = IntArray(width * height)
    for (row in 0 until height) {
      val yRow = row * strideY
      val uRow = (row shr 1) * strideU
      val vRow = (row shr 1) * strideV
      for (col in 0 until width) {
        val y = dataY.get(yRow + col).toInt() and 0xff
        val u = (dataU.get(uRow + (col shr 1)).toInt() and 0xff) - 128
        val v = (dataV.get(vRow + (col shr 1)).toInt() and 0xff) - 128
        val r = (y + ((1436 * v) shr 10)).coerceIn(0, 255)
        val g = (y - ((352 * u + 731 * v) shr 10)).coerceIn(0, 255)
        val b = (y + ((1815 * u) shr 10)).coerceIn(0, 255)
        pixels[row * width + col] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
      }
    }
    val bitmap = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    if (rotation % 360 == 0) return bitmap
    val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
    val rotated = Bitmap.createBitmap(bitmap, 0, 0, width, height, matrix, true)
    if (rotated !== bitmap) bitmap.recycle()
    return rotated
  }
}
