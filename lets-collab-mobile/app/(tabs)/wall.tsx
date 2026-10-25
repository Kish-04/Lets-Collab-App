import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ImageBackground, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { MonitorPlay, Sun, Moon, Users } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import { openAdminConnection, useLiveSessions } from '../../lib/adminData';
import { createViewer, getRTCView, isSfuDisabled, sfuSupported, type RemoteProducer, type SfuViewer } from '../../lib/sfuViewer';

type Tile = { producerId: string; name: string; streamURL: string };

const CONNECTING = 'Connecting to the exam media server…';
const NO_CAMERAS = 'No candidate cameras yet; they appear here as candidates connect.';
const DISABLED = 'The exam media server is not enabled on this server (SFU_ENABLED). Use Live Sessions to view candidates one at a time.';

function CameraTile({ tile }: { tile: Tile }) {
  const { colors } = useTheme();
  const RTCView = getRTCView();
  return (
    <View style={[styles.tile, { borderColor: colors.border }]} accessibilityLabel={`Camera of ${tile.name}`}>
      <RTCView streamURL={tile.streamURL} objectFit="cover" style={styles.video} />
      <Text numberOfLines={1} style={[styles.caption, { color: colors.textSecondary, backgroundColor: colors.surface }]}>{tile.name}</Text>
    </View>
  );
}

// Every candidate camera of one supervised exam in a grid, received from the exam media server
// (server/sfu.js): each candidate sends its camera once, however many proctors watch.
export default function ExamWallScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark' || theme === 'glassmorphic';
  const liveSessions = useLiveSessions();
  const exams = useMemo(
    () => (liveSessions || []).filter(session => session.mode === 'supervised'),
    [liveSessions],
  );
  const [roomId, setRoomId] = useState('');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [status, setStatus] = useState('');

  // The camera grid gets its own connection: the server frees a viewer's media transports only when
  // its socket disconnects, so changing exam (or leaving the screen) closes it
  useEffect(() => {
    if (!sfuSupported || !roomId) return;
    let cancelled = false;
    let socket: Awaited<ReturnType<typeof openAdminConnection>> = null;
    let viewer: SfuViewer | null = null;
    const watching = new Map<string, () => void>();
    setTiles([]);
    setStatus(CONNECTING);

    const add = async (producer: RemoteProducer) => {
      if (!viewer || cancelled || producer.kind !== 'video' || watching.has(producer.producerId)) return;
      watching.set(producer.producerId, () => {});
      try {
        const camera = await viewer.watch(producer.producerId);
        if (cancelled || !watching.has(producer.producerId)) return camera.release();
        watching.set(producer.producerId, camera.release);
        setStatus(prev => (prev === NO_CAMERAS ? '' : prev));
        setTiles(prev => [...prev, { producerId: producer.producerId, name: producer.name || 'Candidate', streamURL: camera.streamURL }]);
      } catch (err: any) {
        watching.delete(producer.producerId);
        if (!cancelled) setStatus(`Could not show ${producer.name || 'a candidate'}: ${err?.message || err}`);
      }
    };
    const onNew = (producer: RemoteProducer & { roomCode: string }) => {
      if (producer.roomCode === roomId) void add(producer);
    };
    const onClosed = ({ producerId }: { producerId: string }) => {
      const release = watching.get(producerId);
      watching.delete(producerId);
      release?.();
      setTiles(prev => prev.filter(tile => tile.producerId !== producerId));
    };

    (async () => {
      try {
        socket = await openAdminConnection();
        if (cancelled) { socket?.disconnect(); return; }
        if (!socket) throw new Error('You are signed out. Please sign in again.');
        socket.on('sfu-new-producer', onNew);
        socket.on('sfu-producer-closed', onClosed);
        if (!socket.connected) {
          const s = socket;
          await new Promise<void>((resolve, reject) => {
            s.once('connect', () => resolve());
            s.once('connect_error', (err: Error) => reject(new Error(err?.message || 'Could not reach the server')));
          });
        }
        if (cancelled) return;
        viewer = await createViewer(socket, roomId);
        if (cancelled) return viewer.close();
        const producers = await viewer.list();
        if (cancelled) return;
        setStatus(producers.some(p => p.kind === 'video') ? '' : NO_CAMERAS);
        await Promise.all(producers.map(add));
      } catch (err: any) {
        if (cancelled) return;
        setStatus(isSfuDisabled(err) ? DISABLED : `Could not open the exam wall: ${err?.message || err}`);
      }
    })();

    return () => {
      cancelled = true;
      for (const release of watching.values()) release();
      watching.clear();
      viewer?.close();
      socket?.off('sfu-new-producer', onNew);
      socket?.off('sfu-producer-closed', onClosed);
      socket?.disconnect();
    };
  }, [roomId]);

  // The selected exam ended: drop it
  useEffect(() => {
    if (roomId && liveSessions && !liveSessions.some(session => session.id === roomId)) {
      setRoomId('');
      setTiles([]);
      setStatus('');
    }
  }, [liveSessions, roomId]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ImageBackground
        source={require('../../assets/images/grid.svg')}
        style={styles.gridBg}
        imageStyle={{ opacity: isDark ? 0.08 : 0.03, resizeMode: 'repeat' }}
      />

      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MonitorPlay size={22} color={colors.accent} />
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Exam Wall</Text>
          </View>
          <TouchableOpacity onPress={toggleTheme} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {isDark ? <Sun size={16} color={colors.textSecondary} /> : <Moon size={16} color={colors.textSecondary} />}
          </TouchableOpacity>
        </View>

        {!sfuSupported ? (
          <View style={styles.webNotice}>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <MonitorPlay color={colors.accent} size={28} />
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Open the exam wall in the app</Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                The exam wall shows every candidate camera at once and is available in the iOS and Android app, or on the web dashboard under Admin, Exam wall.
              </Text>
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Every candidate camera of a supervised exam at once, through the exam media server.
            </Text>

            <Text style={[styles.sectionLabel, { color: colors.textDim }]}>LIVE SUPERVISED EXAMS</Text>
            {liveSessions === null ? (
              <View style={styles.row}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[styles.dim, { color: colors.textDim }]}>Loading live exams…</Text>
              </View>
            ) : exams.length === 0 ? (
              <Text style={[styles.dim, { color: colors.textDim }]}>No supervised exam is live.</Text>
            ) : (
              <View style={styles.chips} accessibilityLabel="Live supervised exams">
                {exams.map(exam => {
                  const selected = exam.id === roomId;
                  return (
                    <TouchableOpacity
                      key={exam.id}
                      onPress={() => setRoomId(exam.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[styles.chip, selected
                        ? { backgroundColor: colors.accent, borderColor: colors.accent }
                        : { backgroundColor: colors.surface, borderColor: colors.border }]}
                    >
                      <Text style={[styles.chipCode, { color: selected ? '#080810' : colors.textPrimary }]}>{exam.id}</Text>
                      <View style={styles.row}>
                        <Users size={12} color={selected ? '#080810' : colors.textSecondary} />
                        <Text style={[styles.chipDetail, { color: selected ? '#080810' : colors.textSecondary }]}>
                          {exam.host || 'Unknown host'} · {exam.controllerCount ?? 0} candidate(s)
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {!!status && (
              <View style={[styles.statusBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={[styles.statusText, { color: colors.textSecondary }]}>
                  {status}
                </Text>
              </View>
            )}

            {!roomId && exams.length > 0 && (
              <Text style={[styles.dim, { color: colors.textDim }]}>Choose an exam to see its candidates.</Text>
            )}

            <View style={styles.grid}>
              {tiles.map(tile => <CameraTile key={tile.producerId} tile={tile} />)}
            </View>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gridBg: { ...StyleSheet.absoluteFill },
  content: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 40, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  iconBtn: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  scroll: { padding: 16, paddingBottom: 120, gap: 12 },
  subtitle: { fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 18 },
  sectionLabel: { fontFamily: 'SpaceMono', fontSize: 10, letterSpacing: 1.5, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dim: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  chipCode: { fontFamily: 'SpaceMono', fontSize: 13, fontWeight: '700' },
  chipDetail: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  statusBox: { borderWidth: 1, borderRadius: 12, padding: 12 },
  statusText: { fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  tile: { width: '48.5%', borderWidth: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' },
  video: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#000' },
  caption: { fontSize: 11, fontFamily: 'Inter_500Medium', paddingHorizontal: 8, paddingVertical: 4 },
  webNotice: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, borderRadius: 24, borderWidth: 1, padding: 24, gap: 8 },
  cardTitle: { fontFamily: 'Inter_900Black', fontSize: 20 },
  body: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
});
