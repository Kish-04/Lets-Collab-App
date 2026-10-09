Pod::Spec.new do |s|
  s.name           = 'LcProctoring'
  s.version        = '1.0.0'
  s.summary        = "On-device proctoring for Let's Collab (taps react-native-webrtc camera frames)"
  s.description    = 'Analyses frames of the existing WebRTC camera track with MediaPipe, without opening the camera again.'
  s.license        = 'MIT'
  s.author         = "Let's Collab"
  s.homepage       = 'https://github.com/kishankarthiks'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # VideoFrameProcessorDelegate / ProcessorProvider live in react-native-webrtc; RTCVideoFrame in JitsiWebRTC.
  s.dependency 'react-native-webrtc'
  s.dependency 'JitsiWebRTC'
  s.dependency 'MediaPipeTasksVision', '0.10.33'

  s.source_files = "**/*.{h,m,swift}"
  s.public_header_files = "LCFrameTap.h"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
