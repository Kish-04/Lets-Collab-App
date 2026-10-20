import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import io from 'socket.io-client';
import { X, Eye } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { BACKEND_URL, getStoredAuthToken } from '../lib/api';
import { fetchIceServers } from '../lib/liveSession';
import { listen } from '../lib/peerEvents';

/**
 * Live view of a host's screen for admins, same protocol as the web dashboard:
 *   -> request-observation(roomId)
 *   <- observation-pending | observation-denied | observation-granted
 *   <- observer-offer {offer, hostId}   -> observer-answer {hostId, answer}
 *   <-> observer-ice-candidate
 * It uses its own socket, so closing the view disconnects it and the server drops the observer.
 */
export function ObserverView({ roomId, onClose }: { roomId: string | null; onClose: () => void }) {
  const { colors } = useTheme();
  const [status, setStatus] = useState('Requesting observation...');
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let socket: ReturnType<typeof io> | null = null;
    setStatus('Requesting observation...');
    setStream(null);

    (async () => {
      const [token, iceServers] = await Promise.all([getStoredAuthToken(), fetchIceServers()]);
      if (cancelled || !token) return;
      socket = io(BACKEND_URL, { auth: { token }, transports: ['websocket', 'polling'] });
      const s = socket;

      s.on('connect', () => s.emit('request-observation', roomId));
      s.on('observation-pending', () => setStatus('Waiting for host approval'));
      s.on('observation-denied', () => setStatus('Host declined screen observation'));
      s.on('observation-granted', () => setStatus('Connecting to host screen'));
      s.on('admin-error', (message: string) => setStatus(String(message)));

      s.on('observer-offer', async ({ offer, hostId }: { offer: any; hostId: string }) => {
        pc?.close();
        const peer = new RTCPeerConnection({ iceServers });
        pc = peer;
        listen(peer, 'track', (event) => {
          const remote = event.streams?.[0];
          if (remote) {
            setStream(remote);
            setStatus('Live observation active');
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
          setStatus(`Could not connect: ${err?.message || err}`);
        }
      });
      s.on('observer-ice-candidate', async ({ candidate }: { candidate: any }) => {
        try { await pc?.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* late candidate */ }
      });
    })();

    return () => {
      cancelled = true;
      pc?.close();
      socket?.disconnect();
    };
  }, [roomId]);

  return (
    <Modal visible={!!roomId} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: '#000' }]}>
        {stream ? (
          <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit="contain" />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )}
        <View style={styles.topBar}>
          <View style={styles.badge}>
            <Eye size={14} color={colors.accent} />
            <Text style={[styles.badgeText, { color: '#fff' }]}>ROOM {roomId} - {status}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.close}>
            <X size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 28, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, flexShrink: 1 },
  badgeText: { fontSize: 11, fontFamily: 'SpaceMono' },
  close: { padding: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8 },
});
