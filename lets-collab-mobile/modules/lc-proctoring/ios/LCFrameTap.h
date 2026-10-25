#import <Foundation/Foundation.h>
#import <CoreVideo/CoreVideo.h>

NS_ASSUME_NONNULL_BEGIN

/// Called on the WebRTC capture thread with a camera frame and its RTCVideoRotation (0/90/180/270).
typedef void (^LCFrameTapHandler)(CVPixelBufferRef pixelBuffer, NSInteger rotation);

/// Registers a pass-through react-native-webrtc VideoFrameProcessor (see ProcessorProvider) that samples
/// at most one frame every `intervalMs` while the previous sample is not still being analysed.
/// Frames are always forwarded to WebRTC unchanged. Kept free of WebRTC types so Swift can import it.
@interface LCFrameTap : NSObject

+ (void)registerWithName:(NSString *)name intervalMs:(NSInteger)intervalMs handler:(LCFrameTapHandler)handler;
+ (void)unregisterWithName:(NSString *)name;
/// Call when the analysis of the last sampled frame has finished.
+ (void)markIdle;

@end

NS_ASSUME_NONNULL_END
