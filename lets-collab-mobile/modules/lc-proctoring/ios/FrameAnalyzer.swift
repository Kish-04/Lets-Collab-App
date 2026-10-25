import MediaPipeTasksVision
import UIKit

/// Runs the same models as the web proctoring engine (lib/AntiCheatEngine.ts):
///  - MediaPipe FaceLandmarker (face_landmarker.task, up to 3 faces, blendshapes)
///  - MediaPipe ObjectDetector with EfficientDet-Lite0 (COCO labels, includes "cell phone")
/// Only used from the module's serial inference queue.
final class FrameAnalyzer {
  private let faceLandmarker: FaceLandmarker
  private let objectDetector: ObjectDetector?

  var hasObjectDetector: Bool { objectDetector != nil }

  init(faceModelPath: String, objectModelPath: String?) throws {
    let faceOptions = FaceLandmarkerOptions()
    faceOptions.baseOptions.modelAssetPath = faceModelPath
    faceOptions.runningMode = .image
    faceOptions.numFaces = 3
    faceOptions.outputFaceBlendshapes = true
    faceLandmarker = try FaceLandmarker(options: faceOptions)

    if let objectModelPath {
      let objectOptions = ObjectDetectorOptions()
      objectOptions.baseOptions.modelAssetPath = objectModelPath
      objectOptions.runningMode = .image
      objectOptions.scoreThreshold = 0.5
      objectOptions.maxResults = 5
      objectDetector = try ObjectDetector(options: objectOptions)
    } else {
      objectDetector = nil
    }
  }

  func analyze(_ uiImage: UIImage) throws -> [String: Any?] {
    let image = try MPImage(uiImage: uiImage)

    let faces = try faceLandmarker.detect(image: image)
    var headOffset: Double? = nil
    var maxEyeLook = 0.0
    if let marks = faces.faceLandmarks.first, marks.count > 263 {
      // Same metric as the web: nose tip (1) offset from the eye-corner midpoint (33, 263), in eye widths.
      let eyeWidth = abs(marks[263].x - marks[33].x)
      if eyeWidth > 1e-4 {
        headOffset = Double(abs(marks[1].x - (marks[33].x + marks[263].x) / 2) / eyeWidth)
      }
    }
    if let shapes = faces.faceBlendshapes.first {
      for category in shapes.categories where (category.categoryName ?? "").hasPrefix("eyeLook") {
        maxEyeLook = max(maxEyeLook, Double(category.score))
      }
    }

    var objects: [[String: Any]] = []
    if let objectDetector {
      for detection in try objectDetector.detect(image: image).detections {
        guard let top = detection.categories.max(by: { $0.score < $1.score }) else { continue }
        objects.append(["label": top.categoryName ?? "", "score": Double(top.score)])
      }
    }

    return [
      "timestamp": Date().timeIntervalSince1970 * 1000,
      "width": Int(uiImage.size.width),
      "height": Int(uiImage.size.height),
      "faceCount": faces.faceLandmarks.count,
      "headOffset": headOffset,
      "maxEyeLook": maxEyeLook,
      "objectDetection": objectDetector != nil,
      "objects": objects,
    ]
  }
}
