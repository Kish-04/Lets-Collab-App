// Capture constraints and WebRTC sender settings for the session page.
//
// Screen share: at most 1920 px wide at 30 frames a second. Without remote control the content is
// mostly text, so the encoder keeps resolution ("detail"); while a controller has control it keeps the
// frame rate instead ("motion"), because a smooth cursor and quick response matter more than crisp
// text. Cameras are capped at 30 frames a second and a bitrate that suits their resolution.

/** Collaboration: 720p is plenty for a call; supervised exams: 480p (proctoring models work on 640 px) */
export function cameraConstraints(supervised: boolean): MediaTrackConstraints {
    return supervised
        ? { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 30, max: 30 } }
        : { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 30, max: 30 } }
}

export const SCREEN_CONSTRAINTS: DisplayMediaStreamOptions = {
    video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 30, max: 30 } },
    audio: true,
}

export type DegradationPreference = 'maintain-framerate' | 'maintain-resolution' | 'balanced'

export interface VideoSenderPlan {
    maxBitrate: number
    maxFramerate: number
    degradationPreference: DegradationPreference
    /** Only set on screen tracks; cameras keep the browser default */
    contentHint?: 'detail' | 'motion'
}

export function videoSenderPlan(kind: 'screen' | 'camera', remoteControl: boolean): VideoSenderPlan {
    if (kind === 'camera') return { maxBitrate: 1_200_000, maxFramerate: 30, degradationPreference: 'balanced' }
    return remoteControl
        ? { maxBitrate: 4_000_000, maxFramerate: 30, degradationPreference: 'maintain-framerate', contentHint: 'motion' }
        : { maxBitrate: 2_500_000, maxFramerate: 30, degradationPreference: 'maintain-resolution', contentHint: 'detail' }
}

export function applyScreenTrackHint(track: MediaStreamTrack | undefined, remoteControl: boolean) {
    const hint = videoSenderPlan('screen', remoteControl).contentHint
    if (track && hint && track.contentHint !== hint) track.contentHint = hint
}

type SendParameters = RTCRtpSendParameters & { degradationPreference?: DegradationPreference }

/**
 * Applies the plan to every video sender of `pc`. Senders only have encodings once the connection is
 * negotiated, so call it again when the signaling state returns to "stable".
 */
export async function tuneVideoSenders(pc: RTCPeerConnection, isScreen: (track: MediaStreamTrack) => boolean, remoteControl: boolean) {
    if (pc.signalingState === 'closed') return
    for (const sender of pc.getSenders()) {
        const track = sender.track
        if (!track || track.kind !== 'video') continue
        const screen = isScreen(track)
        const plan = videoSenderPlan(screen ? 'screen' : 'camera', remoteControl)
        if (screen) applyScreenTrackHint(track, remoteControl)
        const params = sender.getParameters() as SendParameters
        if (!params.encodings || params.encodings.length === 0) continue
        let changed = false
        for (const encoding of params.encodings) {
            if (encoding.maxBitrate !== plan.maxBitrate) { encoding.maxBitrate = plan.maxBitrate; changed = true }
            if (encoding.maxFramerate !== plan.maxFramerate) { encoding.maxFramerate = plan.maxFramerate; changed = true }
        }
        const wantsPreference = params.degradationPreference !== plan.degradationPreference
        if (wantsPreference) params.degradationPreference = plan.degradationPreference
        if (!changed && !wantsPreference) continue
        try {
            await sender.setParameters(params)
        } catch {
            // Some browsers reject degradationPreference; keep the bitrate and frame-rate caps
            if (!wantsPreference || !changed) continue
            const retry = sender.getParameters() as SendParameters
            retry.encodings?.forEach(encoding => { encoding.maxBitrate = plan.maxBitrate; encoding.maxFramerate = plan.maxFramerate })
            await sender.setParameters(retry).catch(() => { })
        }
    }
}
