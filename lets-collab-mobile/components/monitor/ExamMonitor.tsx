import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MediaStream, MediaStreamTrack, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import type { Socket } from 'socket.io-client';
import { AlertTriangle, EyeOff, Minimize2, SendHorizontal, Users, VideoOff, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { AnimatedPressable } from '../AnimatedPressable';
import { openAdminConnection } from '../../lib/adminData';
import { fetchIceServers } from '../../lib/liveSession';
import { listen } from '../../lib/peerEvents';
import { hasLiveVideo, watchTrack } from '../../lib/mediaWatch';

export type ExamMonitorProps = {
  /** Supervised room to monitor; null hides the monitor and ends every camera feed. */
  roomId: string | null;
  onClose: () => void;
};

export type MonitorCandidate = { id: string; name?: string; email?: string };

type FeedState = 'requesting' | 'connecting' | 'live' | 'no-video' | 'failed';
type Feed = { state: FeedState; streamURL: string | null };

type MonitorStatus =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'error'; message: string };

const ACK_TIMEOUT_MS = 10000;
/** How long a connected candidate may go without a picture before the tile says so. */
const NO_VIDEO_AFTER_MS = 4000;

const FEED_TEXT: Record<Exclude<FeedState, 'live'>, string> = {
  requesting: 'Requesting camera...',
  connecting: 'Connecting...',
  'no-video': 'No video from this candidate',
  failed: 'Connection failed',
};

/**
 * Silent exam monitor for administrators: every candidate camera of one supervised room in a grid,
 * without telling the candidates. Uses one dedicated connection (the server ends the observations
 * when it closes), so closing or unmounting the monitor disconnects it.
 *   -> monitor-exam {roomId} (ack {ok, roomId, candidates} | {ok:false, error})
 *   <- monitor-roster {roomId, candidates}
 *   -> request-controller-observation {roomId, targetId, silent:true}   (one per candidate)
 *   <- observer-offer {offer, hostId, targetType:'controller'}   -> observer-answer {hostId, answer}
 *   <-> observer-ice-candidate {targetId, candidate} / {candidate, fromId}
 *   -> end-controller-observation {targetId?}, stop-monitor-exam {roomId}
 *   -> admin-room-chat {roomId, text}   (reveals the administrator: the room sees the message)
 */
export function ExamMonitor({ roomId, onClose }: ExamMonitorProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<MonitorStatus>({ kind: 'connecting' });
  const [candidates, setCandidates] = useState<MonitorCandidate[]>([]);
  const [feeds, setFeeds] = useState<Record<string, Feed>>({});
  const [notice, setNotice] = useState('');
  const [enlargedId, setEnlargedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [sentNotice, setSentNotice] = useState('');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let socket: Socket | null = null;
    let iceServers: Awaited<ReturnType<typeof fetchIceServers>> = [];
    const pcs = new Map<string, RTCPeerConnection>();
    const pendingIce = new Map<string, any[]>();
    const remoteStreams = new Map<string, MediaStream>();
    const trackWatchers = new Map<string, (() => void)[]>();
    const noVideoTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const requested = new Set<string>();
    const shown = new Map<string, FeedState>();

    setStatus({ kind: 'connecting' });
    setCandidates([]);
    setFeeds({});
    setNotice('');
    setEnlargedId(null);
    setMessage('');
    setSentNotice('');

    const setFeed = (id: string, feed: Feed) => {
      if (cancelled) return;
      shown.set(id, feed.state);
      setFeeds(prev => {
        const current = prev[id];
        if (current && current.state === feed.state && current.streamURL === feed.streamURL) return prev;
        return { ...prev, [id]: feed };
      });
    };

    const closeFeed = (id: string) => {
      const pc = pcs.get(id);
      if (pc) {
        try { pc.close(); } catch { /* already closed */ }
      }
      pcs.delete(id);
      pendingIce.delete(id);
      remoteStreams.delete(id);
      shown.delete(id);
      (trackWatchers.get(id) || []).forEach(off => off());
      trackWatchers.delete(id);
      const timer = noVideoTimers.get(id);
      if (timer) clearTimeout(timer);
      noVideoTimers.delete(id);
    };

    /** A tile shows video only while its stream has a live video track. */
    const evaluate = (id: string) => {
      const pc = pcs.get(id);
      if (!pc || cancelled) return;
      const stream = remoteStreams.get(id);
      if (stream && hasLiveVideo(stream)) {
        const timer = noVideoTimers.get(id);
        if (timer) clearTimeout(timer);
        noVideoTimers.delete(id);
        setFeed(id, { state: 'live', streamURL: stream.toURL() });
        return;
      }
      if (pc.connectionState === 'failed') {
        setFeed(id, { state: 'failed', streamURL: null });
        return;
      }
      // Already reported as without video: stay so until a picture arrives (no flicker)
      if (shown.get(id) === 'no-video') return;
      if ((stream || pc.connectionState === 'connected') && !noVideoTimers.has(id)) {
        noVideoTimers.set(id, setTimeout(() => {
          noVideoTimers.delete(id);
          const latest = remoteStreams.get(id);
          if (cancelled || !pcs.has(id) || (latest && hasLiveVideo(latest))) return;
          setFeed(id, { state: 'no-video', streamURL: null });
        }, NO_VIDEO_AFTER_MS));
      }
      setFeed(id, { state: 'connecting', streamURL: null });
    };

    const requestFeed = (id: string) => {
      if (!socket || requested.has(id)) return;
      requested.add(id);
      setFeed(id, { state: 'requesting', streamURL: null });
      socket.emit('request-controller-observation', { roomId, targetId: id, silent: true });
    };

    const applyRoster = (list: unknown) => {
      if (cancelled || !Array.isArray(list)) return;
      const next = (list as MonitorCandidate[]).filter(item => item && typeof item.id === 'string');
      const ids = new Set(next.map(item => item.id));
      // Candidates that left: close their connection and drop the tile
      Array.from(requested).forEach(id => {
        if (ids.has(id)) return;
        requested.delete(id);
        closeFeed(id);
      });
      setFeeds(prev => {
        const kept: Record<string, Feed> = {};
        Object.keys(prev).forEach(id => { if (ids.has(id)) kept[id] = prev[id]; });
        return kept;
      });
      setEnlargedId(prev => (prev && !ids.has(prev) ? null : prev));
      setCandidates(next);
      next.forEach(item => requestFeed(item.id));
    };

    const startMonitor = (s: Socket) => {
      // A reconnect is a new admin socket: the server has dropped the old observations
      Array.from(pcs.keys()).forEach(closeFeed);
      requested.clear();
      setStatus({ kind: 'connecting' });
      s.timeout(ACK_TIMEOUT_MS).emit('monitor-exam', { roomId }, (err: Error | null, reply: any) => {
        if (cancelled) return;
        if (err) {
          setStatus({ kind: 'error', message: 'The server did not answer the monitor request. It may be running an older version without the silent exam monitor.' });
          return;
        }
        if (!reply || reply.ok !== true) {
          setStatus({ kind: 'error', message: String(reply?.error || 'The server refused to start the exam monitor.') });
          return;
        }
        setStatus({ kind: 'live' });
        applyRoster(reply.candidates);
      });
    };

    (async () => {
      const [connection, servers] = await Promise.all([openAdminConnection(), fetchIceServers()]);
      if (cancelled) {
        connection?.disconnect();
        return;
      }
      if (!connection) {
        setStatus({ kind: 'error', message: 'You are signed out. Sign in again to monitor the exam.' });
        return;
      }
      iceServers = servers;
      socket = connection;
      socketRef.current = connection;
      const s = connection;

      s.on('connect', () => startMonitor(s));
      s.on('connect_error', (err: Error) => {
        if (!cancelled) setStatus({ kind: 'error', message: `Could not reach the server: ${err?.message || 'connection error'}` });
      });
      s.on('disconnect', (reason: string) => {
        if (cancelled || reason === 'io client disconnect') return;
        Array.from(pcs.keys()).forEach(closeFeed);
        requested.clear();
        setFeeds({});
        setStatus({ kind: 'connecting' });
      });
      s.on('monitor-roster', (payload: { roomId?: string; candidates?: unknown } = {}) => {
        if (payload.roomId && String(payload.roomId) !== roomId) return;
        applyRoster(payload.candidates);
      });
      // For example a candidate without a camera ('controller-observation-unavailable')
      s.on('admin-error', (text: string) => { if (!cancelled) setNotice(String(text)); });
      // Silent feeds report a candidate without a camera with this event instead of admin-error
      s.on('monitor-feed-unavailable', ({ candidateId, reason }: { candidateId?: string; reason?: string } = {}) => {
        if (cancelled || !candidateId) return;
        setFeed(candidateId, { state: 'no-video', streamURL: null });
        if (reason) setNotice(String(reason));
      });

      s.on('observer-offer', async ({ offer, hostId, targetType }: { offer?: any; hostId?: string; targetType?: string } = {}) => {
        if (cancelled || !hostId || !offer || (targetType && targetType !== 'controller')) return;
        const early = pendingIce.get(hostId) || [];
        closeFeed(hostId);
        requested.add(hostId);
        const peer = new RTCPeerConnection({ iceServers });
        pcs.set(hostId, peer);
        setFeed(hostId, { state: 'connecting', streamURL: null });

        listen(peer, 'track', event => {
          if (cancelled || pcs.get(hostId) !== peer) return;
          const incoming = event.streams?.[0];
          if (!incoming) return;
          const current = remoteStreams.get(hostId);
          if (!current || !hasLiveVideo(current) || hasLiveVideo(incoming)) remoteStreams.set(hostId, incoming);
          const track = (event as { track?: MediaStreamTrack | null }).track;
          if (track) {
            const off = watchTrack(track, () => evaluate(hostId));
            trackWatchers.set(hostId, [...(trackWatchers.get(hostId) || []), off]);
          }
          evaluate(hostId);
        });
        listen(peer, 'icecandidate', event => {
          if (event.candidate) s.emit('observer-ice-candidate', { targetId: hostId, candidate: event.candidate });
        });
        listen(peer, 'connectionstatechange', () => {
          if (pcs.get(hostId) === peer) evaluate(hostId);
        });

        try {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const queued = [...early, ...(pendingIce.get(hostId) || [])];
          pendingIce.delete(hostId);
          for (const candidate of queued) await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => { });
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          if (cancelled || pcs.get(hostId) !== peer) return;
          s.emit('observer-answer', { hostId, answer: { type: answer.type, sdp: answer.sdp } });
        } catch (err) {
          console.warn('Could not answer a candidate camera offer', err);
          setFeed(hostId, { state: 'failed', streamURL: null });
        }
      });

      s.on('observer-ice-candidate', async ({ candidate, fromId }: { candidate?: any; fromId?: string } = {}) => {
        if (!candidate || !fromId) return;
        const pc = pcs.get(fromId);
        if (!pc || !pc.remoteDescription) {
          pendingIce.set(fromId, [...(pendingIce.get(fromId) || []), candidate].slice(-100));
          return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => { });
      });
    })().catch(err => {
      if (!cancelled) setStatus({ kind: 'error', message: `Could not start the monitor: ${err?.message || err}` });
    });

    return () => {
      cancelled = true;
      Array.from(pcs.keys()).forEach(closeFeed);
      socketRef.current = null;
      if (socket) {
        if (socket.connected) {
          socket.emit('end-controller-observation', {});
          socket.emit('stop-monitor-exam', { roomId });
        }
        socket.disconnect();
        socket = null;
      }
    };
  }, [roomId]);

  const sendMessage = useCallback(() => {
    const text = message.trim();
    const socket = socketRef.current;
    if (!text || !roomId) return;
    if (!socket?.connected) {
      Alert.alert('Offline', 'Not connected to the server; try again in a moment.');
      return;
    }
    Alert.alert(
      'Reveal your presence?',
      `Everyone in room ${roomId} will see this message from "Administrator", so they will know the exam is being watched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          style: 'destructive',
          onPress: () => {
            socket.emit('admin-room-chat', { roomId, text });
            setMessage('');
            setSentNotice(`Sent at ${new Date().toLocaleTimeString()}`);
          },
        },
      ],
    );
  }, [message, roomId]);

  const enlarged = enlargedId ? candidates.find(item => item.id === enlargedId) : null;
  const enlargedFeed = enlargedId ? feeds[enlargedId] : undefined;
  const nameOf = (item: MonitorCandidate) => item.name || item.email || 'Candidate';

  const placeholder = (feed: Feed | undefined, big = false) => {
    const state = feed?.state || 'requesting';
    if (state === 'live') return null;
    const busy = state === 'requesting' || state === 'connecting';
    return (
      <View style={[styles.placeholder, { backgroundColor: colors.surface }]}>
        {busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <VideoOff color={state === 'failed' ? colors.red : colors.textDim} size={big ? 32 : 20} />
        )}
        <Text style={[styles.placeholderText, { color: state === 'failed' ? colors.red : colors.textSecondary }]}>
          {FEED_TEXT[state]}
        </Text>
      </View>
    );
  };

  const renderTile = ({ item }: { item: MonitorCandidate }) => {
    const feed = feeds[item.id];
    return (
      <AnimatedPressable
        hapticFeedback="light"
        onPress={() => setEnlargedId(item.id)}
        accessibilityLabel={`Camera of ${nameOf(item)}. Tap to enlarge.`}
        style={[styles.tile, { borderColor: feed?.state === 'live' ? colors.accent + '66' : colors.border }]}
      >
        {feed?.state === 'live' && feed.streamURL ? (
          <RTCView key={feed.streamURL} streamURL={feed.streamURL} objectFit="cover" style={styles.video} zOrder={0} />
        ) : (
          placeholder(feed)
        )}
        <View style={styles.caption}>
          <Text style={styles.captionText} numberOfLines={1}>{nameOf(item)}</Text>
        </View>
      </AnimatedPressable>
    );
  };

  const isError = status.kind === 'error';

  return (
    <Modal visible={!!roomId} animationType="slide" onRequestClose={enlargedId ? () => setEnlargedId(null) : onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}
      >
        <View style={styles.header}>
          <View style={{ flexShrink: 1 }}>
            <Text style={[styles.headerLabel, { color: colors.textDim }]}>SILENT EXAM MONITOR - ROOM {roomId}</Text>
            <View style={styles.headerRow}>
              <EyeOff size={14} color={colors.accent} />
              <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                {status.kind === 'live'
                  ? `${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`
                  : status.kind === 'connecting' ? 'Connecting...' : 'Monitor unavailable'}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]} accessibilityLabel="Close exam monitor">
            <X size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.subtle, { color: colors.textDim }]}>
          Candidates are not told they are being watched. Tap a camera to enlarge it.
        </Text>

        {!!notice && (
          <View style={[styles.banner, { borderColor: colors.amber + '55', backgroundColor: colors.amber + '15' }]}>
            <AlertTriangle size={14} color={colors.amber} />
            <Text style={[styles.bannerText, { color: colors.amber }]}>{notice}</Text>
            <TouchableOpacity onPress={() => setNotice('')} accessibilityLabel="Dismiss">
              <X size={14} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.body}>
          {isError ? (
            <View style={styles.center}>
              <AlertTriangle size={32} color={colors.red} />
              <Text style={[styles.centerText, { color: colors.red }]}>{status.message}</Text>
            </View>
          ) : status.kind === 'connecting' ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={[styles.centerText, { color: colors.textSecondary }]}>Starting the exam monitor...</Text>
            </View>
          ) : enlarged ? (
            // The grid is not rendered while a camera is enlarged: video surfaces may draw over other views
            <View style={[styles.enlarged, { borderColor: colors.accent + '66' }]}>
              {enlargedFeed?.state === 'live' && enlargedFeed.streamURL ? (
                <RTCView key={enlargedFeed.streamURL} streamURL={enlargedFeed.streamURL} objectFit="contain" style={styles.video} zOrder={0} />
              ) : (
                placeholder(enlargedFeed, true)
              )}
              <View style={styles.enlargedBar}>
                <Text style={styles.captionText} numberOfLines={1}>
                  {nameOf(enlarged)}{enlarged.email && enlarged.name ? ` - ${enlarged.email}` : ''}
                </Text>
                <TouchableOpacity onPress={() => setEnlargedId(null)} style={styles.shrinkBtn} accessibilityLabel="Back to all cameras">
                  <Minimize2 size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <FlatList
              data={candidates}
              keyExtractor={item => item.id}
              numColumns={2}
              renderItem={renderTile}
              columnWrapperStyle={{ gap: 8 }}
              contentContainerStyle={{ gap: 8, paddingBottom: 8, flexGrow: 1 }}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Users size={32} color={colors.textDim} />
                  <Text style={[styles.centerText, { color: colors.textSecondary }]}>
                    No candidates in this exam yet. They appear here as they are admitted.
                  </Text>
                </View>
              }
            />
          )}
        </View>

        <View style={[styles.composer, { borderColor: colors.amber + '55', backgroundColor: colors.surface }]}>
          <Text style={[styles.composerLabel, { color: colors.textDim }]}>MESSAGE THE ROOM AS ADMINISTRATOR</Text>
          <View style={styles.warnRow}>
            <AlertTriangle size={12} color={colors.amber} />
            <Text style={[styles.warnText, { color: colors.amber }]}>
              Sending reveals your presence: every candidate and the examiner see it.
            </Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              value={message}
              onChangeText={text => { setMessage(text); if (sentNotice) setSentNotice(''); }}
              placeholder={status.kind === 'live' ? 'Message to the whole room...' : 'Available once the monitor is running'}
              placeholderTextColor={colors.textDim}
              editable={status.kind === 'live'}
              maxLength={1000}
              multiline
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.bg }]}
            />
            <TouchableOpacity
              onPress={sendMessage}
              disabled={status.kind !== 'live' || !message.trim()}
              accessibilityLabel="Send message to the room"
              style={[styles.sendBtn, { backgroundColor: colors.amber, opacity: status.kind !== 'live' || !message.trim() ? 0.45 : 1 }]}
            >
              <SendHorizontal size={18} color="#080810" />
            </TouchableOpacity>
          </View>
          {!!sentNotice && <Text style={[styles.warnText, { color: colors.emerald, marginTop: 6 }]}>{sentNotice}</Text>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerLabel: { fontSize: 10, fontFamily: 'SpaceMono', letterSpacing: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  iconBtn: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  subtle: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 8, marginBottom: 8 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  bannerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium' },
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  centerText: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', maxWidth: 300 },
  tile: { flex: 1, maxWidth: '50%', aspectRatio: 3 / 4, borderRadius: 10, borderWidth: 1, overflow: 'hidden', backgroundColor: '#000' },
  video: { flex: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 8 },
  placeholderText: { fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: 'rgba(0,0,0,0.6)' },
  captionText: { color: '#fff', fontSize: 12, fontFamily: 'Inter_500Medium', flexShrink: 1 },
  enlarged: { flex: 1, borderRadius: 12, borderWidth: 1, overflow: 'hidden', backgroundColor: '#000' },
  enlargedBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.6)' },
  shrinkBtn: { padding: 6, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.15)' },
  composer: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8 },
  composerLabel: { fontSize: 10, fontFamily: 'SpaceMono', letterSpacing: 1 },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, marginBottom: 8 },
  warnText: { fontSize: 11, fontFamily: 'Inter_500Medium', flexShrink: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === 'ios' ? 10 : 6, fontSize: 14, maxHeight: 96, fontFamily: 'Inter_500Medium' },
  sendBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
