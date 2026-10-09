#import "LCFrameTap.h"

#import <WebRTC/RTCCVPixelBuffer.h>
#import <WebRTC/RTCVideoCapturer.h>
#import <WebRTC/RTCVideoFrame.h>

#if __has_include(<react_native_webrtc/ProcessorProvider.h>)
#import <react_native_webrtc/ProcessorProvider.h>
#elif __has_include(<react-native-webrtc/ProcessorProvider.h>)
#import <react-native-webrtc/ProcessorProvider.h>
#else
#import "ProcessorProvider.h"
#endif

#import <stdatomic.h>

static atomic_bool gBusy = false;

@interface LCFrameTapProcessor : NSObject <VideoFrameProcessorDelegate>
@property(atomic, assign) BOOL active;
@property(atomic, assign) uint64_t intervalNs;
@property(atomic, assign) uint64_t lastSampleNs;
@property(atomic, copy) LCFrameTapHandler handler;
@end

@implementation LCFrameTapProcessor

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame {
    if (!self.active) {
        return frame;
    }
    uint64_t now = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
    if (now - self.lastSampleNs < self.intervalNs) {
        return frame;
    }
    if (![frame.buffer isKindOfClass:[RTCCVPixelBuffer class]]) {
        return frame;
    }
    bool expected = false;
    if (!atomic_compare_exchange_strong(&gBusy, &expected, true)) {
        return frame;
    }
    self.lastSampleNs = now;
    LCFrameTapHandler handler = self.handler;
    if (handler == nil) {
        atomic_store(&gBusy, false);
        return frame;
    }
    CVPixelBufferRef pixelBuffer = ((RTCCVPixelBuffer *)frame.buffer).pixelBuffer;
    // The handler copies/downscales the buffer asynchronously and calls +markIdle when done.
    handler(pixelBuffer, (NSInteger)frame.rotation);
    // The frame itself is forwarded to WebRTC untouched.
    return frame;
}

@end

@implementation LCFrameTap

static LCFrameTapProcessor *gProcessor = nil;

+ (void)registerWithName:(NSString *)name intervalMs:(NSInteger)intervalMs handler:(LCFrameTapHandler)handler {
    @synchronized(self) {
        if (gProcessor == nil) {
            gProcessor = [[LCFrameTapProcessor alloc] init];
        }
        gProcessor.handler = handler;
        gProcessor.intervalNs = (uint64_t)MAX(intervalMs, 200) * NSEC_PER_MSEC;
        gProcessor.lastSampleNs = 0;
        gProcessor.active = YES;
        atomic_store(&gBusy, false);
        [ProcessorProvider addProcessor:gProcessor forName:name];
    }
}

+ (void)unregisterWithName:(NSString *)name {
    @synchronized(self) {
        // An already attached processor stays a harmless pass-through until JS clears the track's effects.
        gProcessor.active = NO;
        gProcessor.handler = nil;
        [ProcessorProvider removeProcessor:name];
    }
}

+ (void)markIdle {
    atomic_store(&gBusy, false);
}

@end
