// Small helpers for deciding whether a received (remote) stream has a picture to show.
// An RTCView of a stream without a live video track renders as a black box, so screens use these
// to show a clear placeholder instead. Types only: importing this file never loads react-native-webrtc.
import type { MediaStream, MediaStreamTrack } from 'react-native-webrtc';

type Listenable = {
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
};

/**
 * True when the stream has a video track that is live and not muted. react-native-webrtc marks a
 * remote video track muted when no frames arrive for a while (sender stopped its camera), and
 * unmuted again when frames resume. A sender that only disables its track (track.enabled = false
 * in a browser) still sends black frames, which cannot be told apart here.
 */
export function hasLiveVideo(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return stream.getVideoTracks().some(track => track.readyState === 'live' && !track.muted);
}

/** Calls onChange whenever the track is muted, unmuted or ends. Returns an unsubscribe function. */
export function watchTrack(track: MediaStreamTrack | null | undefined, onChange: () => void): () => void {
  if (!track) return () => { };
  // react-native-webrtc 124 ships its .d.ts without the event-target-shim types
  const target = track as unknown as Listenable;
  const events = ['mute', 'unmute', 'ended'];
  events.forEach(type => target.addEventListener(type, onChange));
  return () => events.forEach(type => target.removeEventListener(type, onChange));
}
