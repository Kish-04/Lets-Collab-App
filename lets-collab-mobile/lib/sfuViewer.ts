// Native (iOS/Android) viewer for the optional exam media server (server/sfu.js, mediasoup), the
// mobile counterpart of the web's lib/sfuClient.ts createViewer. Candidates publish their camera once;
// this receives any number of them over one receive transport. Signalling runs over a Socket.IO
// connection with acknowledgements (the 'sfu-*' handlers in server/index.js).
//
// mediasoup-client and react-native-webrtc are loaded lazily: react-native-webrtc has no web
// implementation and touches native modules when it is evaluated, so the web build must never run it.
import { Platform } from 'react-native';
import type { Socket } from 'socket.io-client';
import type { Consumer, Device } from 'mediasoup-client/types';

type Reply = { error?: string } & Record<string, any>;

export type RemoteProducer = { producerId: string; kind: 'audio' | 'video'; socketId: string; name: string };

/** A received camera: the mediasoup consumer and a stream URL for RTCView. */
export type WatchedCamera = { consumer: Consumer; streamURL: string; release: () => void };

export type SfuViewer = {
  list: () => Promise<RemoteProducer[]>;
  watch: (producerId: string) => Promise<WatchedCamera>;
  close: () => void;
};

/** True when the server answered that the media server is off (SFU_ENABLED not set). */
export const isSfuDisabled = (err: unknown) => /media server disabled/.test(String((err as Error)?.message || err));

/** The media server needs react-native-webrtc, which only exists in the native app. */
export const sfuSupported = Platform.OS !== 'web';

function ask(socket: Socket, event: string, payload: Record<string, unknown>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, payload, (err: Error | null, reply: Reply) => {
      if (err) reject(new Error(`${event}: no answer from the server`));
      else if (!reply || reply.error) reject(new Error(reply?.error || `${event} failed`));
      else resolve(reply);
    });
  });
}

type WebRTC = typeof import('react-native-webrtc');
let webrtc: WebRTC | null = null;

/** react-native-webrtc, with its RTCPeerConnection/MediaStream globals registered once for mediasoup-client. */
function loadWebRTC(): WebRTC {
  if (!sfuSupported) throw new Error('The exam wall is only available in the iOS and Android app.');
  if (!webrtc) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lib: WebRTC = require('react-native-webrtc');
    lib.registerGlobals();
    webrtc = lib;
  }
  return webrtc;
}

/** The RTCView component (native only). */
export function getRTCView(): WebRTC['RTCView'] {
  return loadWebRTC().RTCView;
}

async function loadDevice(socket: Socket, roomId: string): Promise<Device> {
  loadWebRTC();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Device: MediasoupDevice }: typeof import('mediasoup-client') = require('mediasoup-client');
  const { rtpCapabilities } = await ask(socket, 'sfu-capabilities', { roomId });
  const device = new MediasoupDevice({ handlerName: 'ReactNative106' });
  await device.load({ routerRtpCapabilities: rtpCapabilities });
  return device;
}

/** Receives cameras from the media server for one room. Throws if the server has it disabled. */
export async function createViewer(socket: Socket, roomId: string): Promise<SfuViewer> {
  const device = await loadDevice(socket, roomId);
  const params = await ask(socket, 'sfu-create-transport', { roomId, direction: 'recv' });
  const transport = device.createRecvTransport(params as any);
  transport.on('connect', ({ dtlsParameters }, done, fail) => {
    ask(socket, 'sfu-connect-transport', { transportId: transport.id, dtlsParameters }).then(() => done()).catch(fail);
  });
  return {
    async list() {
      return (await ask(socket, 'sfu-list-producers', { roomId })).producers || [];
    },
    async watch(producerId: string) {
      const reply = await ask(socket, 'sfu-consume', { roomId, transportId: transport.id, producerId, rtpCapabilities: device.rtpCapabilities });
      const consumer = await transport.consume({ id: reply.id, producerId, kind: reply.kind, rtpParameters: reply.rtpParameters });
      try {
        await ask(socket, 'sfu-resume', { consumerId: consumer.id });
      } catch (err) {
        consumer.close();
        throw err;
      }
      const { MediaStream } = loadWebRTC();
      // consumer.track is a react-native-webrtc MediaStreamTrack at runtime (registerGlobals)
      const stream = new MediaStream([consumer.track as any]);
      return {
        consumer,
        streamURL: stream.toURL(),
        // Closing the consumer stops the track; the stream wrapper itself only needs dropping
        release: () => consumer.close(),
      };
    },
    close: () => transport.close(),
  };
}
