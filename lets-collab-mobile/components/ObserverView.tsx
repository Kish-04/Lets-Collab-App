import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import type { Socket } from 'socket.io-client';
import { X, Eye } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { openAdminConnection } from '../lib/adminData';
import { fetchIceServers } from '../lib/liveSession';
import { listen } from '../lib/peerEvents';

export type ObserverViewProps = {
  /** Room to observe; null hides the view and ends the observation. */
  roomId: string | null;
  /** A controller's socket id: watch that participant's camera instead of the host's screen. */
  targetId?: string | null;
  onClose: () => void;
};

const LIVE = 'Live observation active';

/**
 * Live view of a host's screen (or a controller's camera) for admins, same protocol as the web dashboard:
 *   -> request-observation(roomId)  |  request-controller-observation {roomId, targetId}
 *   <- observation-pending | observation-denied | observation-granted | admin-error
 *   <- observer-offer {offer, hostId}   -> observer-answer {hostId, answer}
 *   <-> observer-ice-candidate {targetId, candidate} / {candidate, fromId}
 * The server ends an observation only when the observing socket disconnects, so this view opens its
 * own connection (openAdminConnection) and disconnects it when closed or unmounted.
 */
export function ObserverView({ roomId, targetId, onClose }: ObserverViewProps) {
  const { colors } = useTheme();
  const [status, setStatus] = useState('');
  // True once the observation can no longer progress (declined, error): stops the spinner
  const [stopped, setStopped] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const controllerFeed = !!targetId;

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let socket: Socket | null = null;
    const fail = (message: string) => {
      if (cancelled) return;
      setStatus(message);
      setStopped(true);
    };
    setStatus(controllerFeed ? 'Requesting controller feed' : 'Requesting observation...');
    setStopped(false);
    setStream(null);

    (async () => {
      const [connection, iceServers] = await Promise.all([openAdminConnection(), fetchIceServers()]);
      if (cancelled) {
        connection?.disconnect();
        return;
      }
      if (!connection) return fail('You are signed out. Sign in again to observe.');
      socket = connection;
      const s = connection;

      s.on('connect', () => {
        if (controllerFeed) s.emit('request-controller-observation', { roomId, targetId });
        else s.emit('request-observation', roomId);
      });
      s.on('connect_error', (err: Error) => fail(`Could not reach the server: ${err?.message || 'connection error'}`));
      s.on('observation-pending', () => setStatus('Waiting for host approval'));
      s.on('observation-denied', () => fail('Host declined screen observation'));
      s.on('observation-granted', () => setStatus('Connecting to host screen'));
      s.on('admin-error', (message: string) => fail(String(message)));

      s.on('observer-offer', async ({ offer, hostId }: { offer: any; hostId: string }) => {
        pc?.close();
        const peer = new RTCPeerConnection({ iceServers });
        pc = peer;
        listen(peer, 'track', (event) => {
          const remote = event.streams?.[0];
          if (remote && !cancelled) {
            setStream(remote);
            setStatus(LIVE);
            setStopped(false);
          }
        });
        listen(peer, 'icecandidate', (event) => {
          if (event.candidate) s.emit('observer-ice-candidate', { targetId: hostId, candidate: event.candidate });
        });
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          s.emit('observer-answer', { hostId, answer });
        } catch (err: any) {
          fail(`Could not connect: ${err?.message || err}`);
        }
      });
      s.on('observer-ice-candidate', async ({ candidate }: { candidate: any }) => {
        try { await pc?.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* late candidate */ }
      });
    })();

    return () => {
      cancelled = true;
      pc?.close();
      pc = null;
      if (socket) {
        if (controllerFeed && socket.connected) socket.emit('end-controller-observation');
        socket.disconnect();
        socket = null;
      }
    };
  }, [roomId, targetId, controllerFeed]);

  return (
    <Modal visible={!!roomId} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: '#000' }]}>
        {stream ? (
          <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit="contain" />
        ) : (
          <View style={styles.center}>
            {stopped ? (
              <Text style={[styles.message, { color: colors.red }]}>{status}</Text>
            ) : (
              <>
                <ActivityIndicator color={colors.accent} />
                <Text style={[styles.message, { color: '#ccc' }]}>{status}</Text>
              </>
            )}
          </View>
        )}
        <View style={styles.topBar}>
          <View style={styles.badge}>
            <Eye size={14} color={colors.accent} />
            <Text style={[styles.badgeText, { color: '#fff' }]} numberOfLines={2}>
              {controllerFeed ? 'CONTROLLER CAMERA' : 'VISIBLE ADMIN OBSERVER'} - ROOM {roomId} - {status}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.close} accessibilityLabel="Close observation">
            <X size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  message: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  topBar: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 28, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, flexShrink: 1 },
  badgeText: { fontSize: 11, fontFamily: 'SpaceMono', flexShrink: 1 },
  close: { padding: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8 },
});
