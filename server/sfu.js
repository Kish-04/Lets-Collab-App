// Optional media server (SFU, mediasoup) for supervised exams. Without it every viewer opens a
// peer-to-peer connection to every candidate, which does not scale past a handful of streams. With
// it each candidate sends its camera once and any number of viewers (the host, an admin "exam wall")
// receive it from the server.
//
// Off unless SFU_ENABLED=true. It needs UDP (and TCP fallback) ports reachable from the browsers, so
// it runs on a VM, not on a platform that only forwards HTTP:
//   SFU_ENABLED=true
//   SFU_LISTEN_IP=0.0.0.0           interface to bind
//   SFU_ANNOUNCED_IP=203.0.113.10   public IP or host name browsers connect to
//   SFU_RTC_MIN_PORT=40000  SFU_RTC_MAX_PORT=40999   open these (UDP + TCP) in the firewall
const enabled = process.env.SFU_ENABLED === 'true';

const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 500 } },
];

let workerPromise = null;
const routers = new Map(); // roomCode -> Promise<Router>
const producersByRoom = new Map(); // roomCode -> Map<producerId, { producer, socketId, name }>

function getWorker() {
  if (!workerPromise) {
    const mediasoup = require('mediasoup');
    workerPromise = mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: Number(process.env.SFU_RTC_MIN_PORT || 40000),
      rtcMaxPort: Number(process.env.SFU_RTC_MAX_PORT || 40999),
    }).then((worker) => {
      worker.on('died', () => {
        console.error('[SFU] mediasoup worker died; it will be recreated on the next request');
        workerPromise = null;
        routers.clear();
        producersByRoom.clear();
      });
      return worker;
    });
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

function routerFor(roomCode) {
  if (!routers.has(roomCode)) {
    const created = getWorker().then(worker => worker.createRouter({ mediaCodecs: MEDIA_CODECS }));
    created.catch(() => routers.delete(roomCode));
    routers.set(roomCode, created);
  }
  return routers.get(roomCode);
}

function listenInfos() {
  const ip = process.env.SFU_LISTEN_IP || '0.0.0.0';
  const announcedAddress = process.env.SFU_ANNOUNCED_IP || (ip === '0.0.0.0' ? '127.0.0.1' : undefined);
  return [
    { protocol: 'udp', ip, announcedAddress },
    { protocol: 'tcp', ip, announcedAddress },
  ];
}

// Per-socket media state, closed with the socket
function stateOf(socket) {
  if (!socket.sfu) socket.sfu = { transports: new Map(), producers: new Map(), consumers: new Map() };
  return socket.sfu;
}

async function createTransport(socket, roomCode, direction) {
  const router = await routerFor(roomCode);
  const transport = await router.createWebRtcTransport({
    listenInfos: listenInfos(),
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 600000,
    appData: { roomCode, direction },
  });
  stateOf(socket).transports.set(transport.id, transport);
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

async function connectTransport(socket, transportId, dtlsParameters) {
  const transport = stateOf(socket).transports.get(transportId);
  if (!transport) throw new Error('unknown transport');
  await transport.connect({ dtlsParameters });
}

async function produce(socket, transportId, kind, rtpParameters, name, onNew) {
  const transport = stateOf(socket).transports.get(transportId);
  if (!transport || transport.appData.direction !== 'send') throw new Error('not a send transport');
  if (kind !== 'video' && kind !== 'audio') throw new Error('unsupported kind');
  const roomCode = transport.appData.roomCode;
  const producer = await transport.produce({ kind, rtpParameters, appData: { roomCode, socketId: socket.id } });
  stateOf(socket).producers.set(producer.id, producer);
  if (!producersByRoom.has(roomCode)) producersByRoom.set(roomCode, new Map());
  const entry = { producer, socketId: socket.id, name };
  producersByRoom.get(roomCode).set(producer.id, entry);
  producer.observer.on('close', () => producersByRoom.get(roomCode)?.delete(producer.id));
  if (onNew) onNew(roomCode, describe(entry));
  return producer.id;
}

function describe({ producer, socketId, name }) {
  return { producerId: producer.id, kind: producer.kind, socketId, name };
}

function listProducers(roomCode) {
  return Array.from(producersByRoom.get(roomCode)?.values() || []).filter(entry => !entry.producer.closed).map(describe);
}

async function consume(socket, roomCode, transportId, producerId, rtpCapabilities) {
  const transport = stateOf(socket).transports.get(transportId);
  if (!transport || transport.appData.direction !== 'recv' || transport.appData.roomCode !== roomCode) throw new Error('not a receive transport for this room');
  const router = await routerFor(roomCode);
  if (!producersByRoom.get(roomCode)?.has(producerId)) throw new Error('unknown producer');
  if (!router.canConsume({ producerId, rtpCapabilities })) throw new Error('this browser cannot receive that stream');
  // Start paused: the viewer resumes once its track is attached, so no keyframe is lost
  const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
  stateOf(socket).consumers.set(consumer.id, consumer);
  consumer.on('producerclose', () => {
    stateOf(socket).consumers.delete(consumer.id);
    socket.emit('sfu-producer-closed', { producerId, consumerId: consumer.id });
  });
  return { id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters };
}

async function resume(socket, consumerId) {
  const consumer = stateOf(socket).consumers.get(consumerId);
  if (!consumer) throw new Error('unknown consumer');
  await consumer.resume();
}

function closeSocket(socket) {
  if (!socket.sfu) return;
  socket.sfu.transports.forEach(transport => transport.close()); // also closes its producers/consumers
  socket.sfu = null;
}

async function closeRoom(roomCode) {
  const router = routers.get(roomCode);
  routers.delete(roomCode);
  producersByRoom.delete(roomCode);
  if (router) (await router.catch(() => null))?.close();
}

async function rtpCapabilities(roomCode) {
  return (await routerFor(roomCode)).rtpCapabilities;
}

module.exports = { enabled, rtpCapabilities, createTransport, connectTransport, produce, listProducers, consume, resume, closeSocket, closeRoom };
