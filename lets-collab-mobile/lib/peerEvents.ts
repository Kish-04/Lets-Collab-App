import type { MediaStream, RTCIceCandidate, RTCPeerConnection } from 'react-native-webrtc';

/** The subset of react-native-webrtc's RTCDataChannel this app uses. */
export type DataChannelLike = {
  label: string;
  readyState: string;
  send: (data: string) => void;
  close: () => void;
};

// react-native-webrtc 124 ships its .d.ts without the vendored event-target-shim types,
// so `addEventListener` is missing from RTCPeerConnection's type. Typed wrapper:
export type PeerEvents = {
  datachannel: { channel: DataChannelLike };
  icecandidate: { candidate: RTCIceCandidate | null };
  track: { streams?: MediaStream[] };
  connectionstatechange: unknown;
  signalingstatechange: unknown;
};

type Listenable = {
  addEventListener: (t: string, h: (e: any) => void) => void;
  removeEventListener: (t: string, h: (e: any) => void) => void;
};

export function listen<K extends keyof PeerEvents>(pc: RTCPeerConnection, type: K, handler: (event: PeerEvents[K]) => void) {
  (pc as unknown as Listenable).addEventListener(type, handler);
}

export type DataChannelEvents = {
  open: unknown;
  close: unknown;
  message: { data: string | ArrayBuffer };
};

/** Same idea as `listen()` for RTCDataChannel events. Returns an unsubscribe function. */
export function listenChannel<K extends keyof DataChannelEvents>(
  channel: DataChannelLike,
  type: K,
  handler: (event: DataChannelEvents[K]) => void,
) {
  const target = channel as unknown as Listenable;
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}
