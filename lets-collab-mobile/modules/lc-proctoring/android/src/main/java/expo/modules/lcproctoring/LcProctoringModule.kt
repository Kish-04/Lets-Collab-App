package expo.modules.lcproctoring

import android.net.Uri
import com.oney.WebRTCModule.videoEffects.ProcessorProvider
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessorFactoryInterface
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

const val PROCESSOR_NAME = "lc-proctoring"
const val ANALYSIS_EVENT = "onAnalysis"
const val ERROR_EVENT = "onError"

/**
 * On-device proctoring for the live WebRTC camera track.
 *
 * react-native-webrtc lets apps register a VideoFrameProcessor (ProcessorProvider) and attach it to a
 * local camera track (`track._setVideoEffects([name])` in JS). Every captured frame passes through
 * [TapProcessor.process] on the capture thread; we pass each frame through unchanged (the call
 * video is never altered, paused or delayed) and, at most every `intervalMs`, copy one downscaled
 * frame to CPU memory and analyse it on a background thread with MediaPipe. Only numbers
 * (face count, head offset, object labels) leave this module; frames never do.
 */
class LcProctoringModule : Module() {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private var analyzer: FrameAnalyzer? = null
  private val tap = TapProcessor { i420, rotation -> analyze(i420, rotation) }

  override fun definition() = ModuleDefinition {
    Name("LcProctoring")

    Events(ANALYSIS_EVENT, ERROR_EVENT)

    Constant("processorName") { PROCESSOR_NAME }

    AsyncFunction("start") { faceModelUri: String, objectModelUri: String?, intervalMs: Int, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_NO_CONTEXT", "React context is not available", null)
        return@AsyncFunction
      }
      executor.execute {
        try {
          analyzer?.close()
          analyzer = FrameAnalyzer(context, toPath(faceModelUri), objectModelUri?.let { toPath(it) })
          ProcessorProvider.addProcessor(PROCESSOR_NAME, VideoFrameProcessorFactoryInterface { tap })
          tap.configure(intervalMs.toLong().coerceAtLeast(200L))
          tap.active = true
          promise.resolve(mapOf("objectDetection" to (analyzer?.hasObjectDetector == true)))
        } catch (err: Throwable) {
          tap.active = false
          promise.reject("ERR_PROCTORING_START", err.message ?: err.toString(), err)
        }
      }
    }

    Function("stop") {
      stopInternal()
    }

    OnDestroy {
      stopInternal()
      executor.shutdown()
    }
  }

  private fun stopInternal() {
    // The processor may stay attached to the track until JS clears the effects; once inactive it is a
    // plain pass-through, so it is always safe for frames to keep flowing through it.
    tap.active = false
    try {
      ProcessorProvider.removeProcessor(PROCESSOR_NAME)
    } catch (_: Throwable) {
    }
    executor.execute {
      analyzer?.close()
      analyzer = null
    }
  }

  private fun analyze(i420: VideoFrame.I420Buffer, rotation: Int) {
    try {
      executor.execute {
        try {
          val current = analyzer
          if (current == null || !tap.active) return@execute
          val result = current.analyze(i420, rotation)
          sendEvent(ANALYSIS_EVENT, result)
        } catch (err: Throwable) {
          sendEvent(ERROR_EVENT, mapOf("message" to (err.message ?: err.toString())))
        } finally {
          i420.release()
          tap.busy.set(false)
        }
      }
    } catch (err: Throwable) {
      // Executor already shut down.
      i420.release()
      tap.busy.set(false)
    }
  }

  private fun toPath(uri: String): String =
    if (uri.startsWith("file:")) Uri.parse(uri).path ?: uri.removePrefix("file://") else uri
}

/** Pass-through frame processor that hands a throttled, downscaled CPU copy of the frame to [onSample]. */
class TapProcessor(private val onSample: (VideoFrame.I420Buffer, Int) -> Unit) : VideoFrameProcessor {
  @Volatile var active = false
  val busy = java.util.concurrent.atomic.AtomicBoolean(false)
  @Volatile private var intervalNs = 500_000_000L
  @Volatile private var lastSampleNs = 0L

  fun configure(intervalMs: Long) {
    intervalNs = intervalMs * 1_000_000L
    lastSampleNs = 0L
  }

  override fun process(frame: VideoFrame, textureHelper: SurfaceTextureHelper?): VideoFrame {
    // VideoEffectProcessor releases both the returned frame and the input frame, so returning the
    // input unchanged requires one extra reference.
    frame.retain()
    val now = System.nanoTime()
    if (active && now - lastSampleNs >= intervalNs && busy.compareAndSet(false, true)) {
      lastSampleNs = now
      try {
        val buffer = frame.buffer
        val longSide = maxOf(buffer.width, buffer.height)
        val scale = if (longSide > MAX_SIDE) MAX_SIDE.toFloat() / longSide else 1f
        val width = (buffer.width * scale).toInt() and 1.inv()
        val height = (buffer.height * scale).toInt() and 1.inv()
        // cropAndScale + toI420 copies the frame to CPU memory right here on the capture thread
        // (required for texture-backed camera frames), so no camera texture is held afterwards.
        val scaled = buffer.cropAndScale(0, 0, buffer.width, buffer.height, width, height)
        val i420 = try { scaled.toI420() } finally { scaled.release() }
        if (i420 == null) busy.set(false) else onSample(i420, frame.rotation)
      } catch (err: Throwable) {
        busy.set(false)
      }
    }
    return frame
  }

  companion object {
    const val MAX_SIDE = 480
  }
}
