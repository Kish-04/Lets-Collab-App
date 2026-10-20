import CoreImage
import ExpoModulesCore
import UIKit

let PROCESSOR_NAME = "lc-proctoring"
let ANALYSIS_EVENT = "onAnalysis"
let ERROR_EVENT = "onError"

/// On-device proctoring for the live WebRTC camera track.
///
/// react-native-webrtc lets apps register a frame processor (ProcessorProvider) and attach it to a
/// local camera track (`track._setVideoEffects([name])` in JS). LCFrameTap forwards every frame to
/// WebRTC unchanged and hands at most one frame per `intervalMs` to this module, which downscales it
/// and runs MediaPipe on a background queue. Only numbers leave the module; frames never do.
public class LcProctoringModule: Module {
  private let queue = DispatchQueue(label: "expo.modules.lcproctoring.inference", qos: .userInitiated)
  private let ciContext = CIContext(options: [.cacheIntermediates: false])
  private var analyzer: FrameAnalyzer?

  public func definition() -> ModuleDefinition {
    Name("LcProctoring")

    Events(ANALYSIS_EVENT, ERROR_EVENT)

    Constant("processorName") {
      PROCESSOR_NAME
    }

    AsyncFunction("start") { (faceModelUri: String, objectModelUri: String?, intervalMs: Int, promise: Promise) in
      self.queue.async {
        do {
          self.analyzer = nil
          let analyzer = try FrameAnalyzer(
            faceModelPath: Self.toPath(faceModelUri),
            objectModelPath: objectModelUri.map(Self.toPath)
          )
          self.analyzer = analyzer
          LCFrameTap.register(withName: PROCESSOR_NAME, intervalMs: intervalMs) { [weak self] pixelBuffer, rotation in
            guard let self else {
              LCFrameTap.markIdle()
              return
            }
            self.queue.async {
              defer { LCFrameTap.markIdle() }
              self.analyze(pixelBuffer: pixelBuffer, rotation: rotation)
            }
          }
          promise.resolve(["objectDetection": analyzer.hasObjectDetector])
        } catch {
          promise.reject("ERR_PROCTORING_START", error.localizedDescription)
        }
      }
    }

    Function("stop") {
      self.stopInternal()
    }

    OnDestroy {
      self.stopInternal()
    }
  }

  private func stopInternal() {
    LCFrameTap.unregister(withName: PROCESSOR_NAME)
    queue.async {
      self.analyzer = nil
    }
  }

  private func analyze(pixelBuffer: CVPixelBuffer, rotation: Int) {
    guard let analyzer = analyzer else { return }
    guard let image = uprightImage(pixelBuffer: pixelBuffer, rotation: rotation) else { return }
    do {
      sendEvent(ANALYSIS_EVENT, try analyzer.analyze(image))
    } catch {
      sendEvent(ERROR_EVENT, ["message": error.localizedDescription])
    }
  }

  /// Rotates the camera buffer upright (RTCVideoRotation is clockwise degrees) and downscales it to
  /// at most 480 px on the long side, producing a CPU copy so the camera buffer is released quickly.
  private func uprightImage(pixelBuffer: CVPixelBuffer, rotation: Int) -> UIImage? {
    var image = CIImage(cvPixelBuffer: pixelBuffer)
    switch rotation {
    case 90: image = image.oriented(.right)
    case 180: image = image.oriented(.down)
    case 270: image = image.oriented(.left)
    default: break
    }
    let longSide = max(image.extent.width, image.extent.height)
    if longSide > 480 {
      let scale = 480 / longSide
      image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    }
    guard let cgImage = ciContext.createCGImage(image, from: image.extent) else { return nil }
    return UIImage(cgImage: cgImage)
  }

  private static func toPath(_ uri: String) -> String {
    if uri.hasPrefix("file:"), let url = URL(string: uri) {
      return url.path
    }
    return uri
  }
}
