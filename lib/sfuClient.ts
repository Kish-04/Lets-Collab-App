// Browser side of the optional exam media server (server/sfu.js, mediasoup). A candidate publishes its
// camera once; viewers (host, admin exam wall) receive any number of cameras from the server.
// Signalling runs over the existing Socket.IO connection with acknowledgements.
import type { Socket } from 'socket.io-client'

type Reply = { error?: string } & Record<string, any>

function ask(socket: Socket, event: string, payload: Record<string, unknown>): Promise<Reply> {
    return new Promise((resolve, reject) => {
        socket.timeout(10000).emit(event, payload, (err: Error | null, reply: Reply) => {
            if (err) reject(new Error(`${event}: no answer from the server`))
            else if (!reply || reply.error) reject(new Error(reply?.error || `${event} failed`))
            else resolve(reply)
        })
    })
}

async function loadDevice(socket: Socket, roomId: string) {
    const { Device } = await import('mediasoup-client')
    const { rtpCapabilities } = await ask(socket, 'sfu-capabilities', { roomId })
    let device
    try {
        device = new Device()
    } catch (err) {
        // Browser detection reads the user agent; Chromium builds it does not recognise (headless,
        // some embedded webviews) still have the modern WebRTC API, so fall back to that handler
        if (typeof RTCPeerConnection === 'undefined' || typeof RTCRtpTransceiver === 'undefined') throw err
        device = new Device({ handlerName: 'Chrome111' })
    }
    await device.load({ routerRtpCapabilities: rtpCapabilities })
    return device
}

export const isSfuDisabled = (err: unknown) => /media server disabled/.test(String((err as Error)?.message || err))

/** Sends these tracks to the media server; close() stops sending. */
export async function publishTracks(socket: Socket, roomId: string, tracks: MediaStreamTrack[]) {
    const device = await loadDevice(socket, roomId)
    const params = await ask(socket, 'sfu-create-transport', { roomId, direction: 'send' })
    const transport = device.createSendTransport(params as any)
    transport.on('connect', ({ dtlsParameters }, done, fail) => {
        ask(socket, 'sfu-connect-transport', { transportId: transport.id, dtlsParameters }).then(() => done()).catch(fail)
    })
    transport.on('produce', ({ kind, rtpParameters }, done, fail) => {
        ask(socket, 'sfu-produce', { roomId, transportId: transport.id, kind, rtpParameters }).then(reply => done({ id: reply.id })).catch(fail)
    })
    for (const track of tracks) {
        // The camera track is shared with the call and the proctoring engine, so closing this
        // publication must not stop it (mediasoup stops produced tracks by default).
        // A proctoring view needs a recognisable face, not HD: cap each camera at about 350 kbit/s
        await transport.produce({ track, stopTracks: false, encodings: track.kind === 'video' ? [{ maxBitrate: 350000 }] : undefined })
    }
    return { close: () => transport.close() }
}

export type RemoteProducer = { producerId: string; kind: 'audio' | 'video'; socketId: string; name: string }

/** Receives cameras from the media server for one room. */
export async function createViewer(socket: Socket, roomId: string) {
    const device = await loadDevice(socket, roomId)
    const params = await ask(socket, 'sfu-create-transport', { roomId, direction: 'recv' })
    const transport = device.createRecvTransport(params as any)
    transport.on('connect', ({ dtlsParameters }, done, fail) => {
        ask(socket, 'sfu-connect-transport', { transportId: transport.id, dtlsParameters }).then(() => done()).catch(fail)
    })
    return {
        async list(): Promise<RemoteProducer[]> {
            return (await ask(socket, 'sfu-list-producers', { roomId })).producers
        },
        async watch(producerId: string) {
            const reply = await ask(socket, 'sfu-consume', { roomId, transportId: transport.id, producerId, rtpCapabilities: device.rtpCapabilities })
            const consumer = await transport.consume({ id: reply.id, producerId, kind: reply.kind, rtpParameters: reply.rtpParameters })
            await ask(socket, 'sfu-resume', { consumerId: consumer.id })
            return consumer
        },
        close: () => transport.close(),
    }
}
