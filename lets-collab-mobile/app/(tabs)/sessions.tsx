import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, ImageBackground, TouchableOpacity, Alert, Modal, Platform, ScrollView, Image, Linking, TextInput, Share, KeyboardAvoidingView } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { BACKEND_URL } from '../../lib/api';
import { useAdminSocket, useLiveSessions, useSocketEvent } from '../../lib/adminData';
import { X, Activity, Bolt, Sun, Moon, Brain, AlertTriangle, Eye, ShieldOff, UserMinus, Ban, Film, Search, WifiOff, Link2, Trash2, Square, Camera } from 'lucide-react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { AuditIntegrity } from '../../components/AuditIntegrity';
import { ObserverView } from '../../components/ObserverView';

// Evidence and recording URLs from the server are signed, short-lived /uploads paths
const uploadUri = (url?: string) => (url ? (url.startsWith('http') ? url : `${BACKEND_URL}${url}`) : null);

const DEFAULT_WARNING = 'Warning from administrator: Please return your attention to the session.';
const NOT_CONNECTED = 'Not connected to the server; try again in a moment.';

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const shortHash = (hash: string) => (hash.length > 18 ? `${hash.slice(0, 10)}...${hash.slice(-6)}` : hash);

type Notice = { text: string; tone: 'info' | 'error' };
type Observation = { roomId: string; targetId?: string };

export default function SessionsScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const { socket, connected, status, statusDetail } = useAdminSocket();
  const liveSessions = useLiveSessions();
  const sessions = liveSessions || [];
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Derived from the live list, so the drawer stays fresh and closes when the room ends
  const selectedSession = sessions.find(session => session.id === selectedId) || null;
  const [observation, setObservation] = useState<Observation | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [warnRoom, setWarnRoom] = useState<string | null>(null);
  const [warnText, setWarnText] = useState(DEFAULT_WARNING);
  const [purgeRoom, setPurgeRoom] = useState<string | null>(null);
  const [purgeCode, setPurgeCode] = useState('');
  const [purgeReason, setPurgeReason] = useState('');

  useSocketEvent<{ message: string }>('admin-action-complete', (payload) => setNotice({ text: String(payload?.message || 'Action complete.'), tone: 'info' }));
  useSocketEvent<string>('admin-error', (message) => setNotice({ text: String(message), tone: 'error' }));

  /** Admin actions go out on the shared connection; refuse (visibly) while it is down. */
  const ensureConnected = () => {
    if (!socket || !connected) {
      Alert.alert('Offline', NOT_CONNECTED);
      return false;
    }
    return true;
  };

  const confirm = (title: string, message: string, label: string, run: () => void) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, style: 'destructive', onPress: run },
    ]);
  };

  // Same socket interventions and payloads as the web dashboard (app/admin/sessions/page.tsx)
  const revokeAccess = (roomId: string, controllerId?: string) => {
    if (!ensureConnected()) return;
    if (controllerId) socket!.emit('admin-revoke-access', roomId, controllerId);
    else socket!.emit('admin-revoke-access', roomId);
    setNotice({ text: 'Controller access changed to View Only.', tone: 'info' });
  };
  const removeController = (roomId: string, targetId: string) => {
    if (!ensureConnected()) return;
    socket!.emit('admin-remove-controller', { roomId, targetId });
    setNotice({ text: 'Action submitted.', tone: 'info' });
  };
  const removeAllControllers = (session: any) =>
    confirm('Remove all controllers', `Remove all ${session.controllerCount} controller(s) from room ${session.id}?`, 'Remove all', () => {
      if (!ensureConnected()) return;
      socket!.emit('admin-remove-controller', { roomId: session.id });
      setNotice({ text: 'Action submitted.', tone: 'info' });
    });
  const banController = (roomId: string, controller: any) =>
    confirm('Ban controller', `Ban ${controller.name || 'this controller'} from room ${roomId}?`, 'Ban', () => {
      if (!ensureConnected()) return;
      socket!.emit('admin-ban-participant', { roomId, target: 'controller', targetId: controller.id });
      setNotice({ text: 'Action submitted.', tone: 'info' });
    });
  const banHost = (roomId: string) =>
    confirm('Ban host', `Ban the host of room ${roomId}?`, 'Ban host', () => {
      if (!ensureConnected()) return;
      socket!.emit('admin-ban-participant', { roomId, target: 'host' });
      setNotice({ text: 'Action submitted.', tone: 'info' });
    });
  const terminateSession = (roomId: string) =>
    confirm('Confirm termination', `Forcibly terminate room ${roomId}?`, 'Terminate', () => {
      if (!ensureConnected()) return;
      socket!.emit('kill-session', roomId);
      setNotice({ text: 'Action submitted.', tone: 'info' });
    });

  const openWarning = (roomId: string) => {
    setWarnText(DEFAULT_WARNING);
    setWarnRoom(roomId);
  };
  const sendWarning = () => {
    if (!warnRoom) return;
    const message = warnText.trim();
    if (!message) return;
    if (!ensureConnected()) return;
    socket!.emit('admin-warn-user', { roomId: warnRoom, message });
    setNotice({ text: `Warning sent to room ${warnRoom}`, tone: 'info' });
    setWarnRoom(null);
  };

  const openPurge = (roomId: string) => {
    setPurgeCode('');
    setPurgeReason('');
    setPurgeRoom(roomId);
  };
  const purgeReady = !!purgeRoom && purgeCode.trim() === purgeRoom && purgeReason.trim().length >= 5;
  const requestPurge = () => {
    if (!purgeRoom || !purgeReady) return;
    const roomId = purgeRoom;
    // Second step: an explicit destructive confirmation after the typed code and reason
    confirm('Code Black', `Permanently delete every recording and evidence file for room ${roomId}? This cannot be undone.`, 'Delete everything', () => {
      if (!ensureConnected()) return;
      socket!.emit('secret-delete-recordings', { roomId, confirmCode: purgeCode.trim(), reason: purgeReason.trim() });
      setNotice({ text: 'Code Black requested...', tone: 'info' });
      setPurgeRoom(null);
    });
  };

  const shareHash = (hash: string) => {
    Share.share({ message: hash }).catch(() => { /* dismissed */ });
  };

  const query = search.trim().toLowerCase();
  const filtered = query
    ? sessions.filter(session => String(session.host || '').toLowerCase().includes(query) || String(session.id || '').toLowerCase().includes(query))
    : sessions;

  const stats = [
    { label: 'ACTIVE ROOMS', value: sessions.length, color: colors.accent },
    { label: 'SUPERVISED', value: sessions.filter(session => session.mode === 'supervised').length, color: colors.amber },
    { label: 'HIGH RISK', value: sessions.filter(session => (session.riskScore || 0) >= 70).length, color: colors.red },
    { label: 'OBSERVERS', value: sessions.reduce((total, session) => total + (session.observerCount || 0), 0), color: colors.textPrimary },
  ];

  const isDark = theme === 'dark' || theme === 'glassmorphic';
  const riskColor = (score: number) => (score >= 70 ? colors.red : score >= 30 ? colors.amber : colors.emerald);
  const statusColor = (value: string) => (value === 'high-risk' ? colors.red : value === 'idle' ? colors.textDim : colors.emerald);

  const noticeBanner = notice ? (
    <View style={[styles.banner, { borderColor: (notice.tone === 'error' ? colors.red : colors.accent) + '55', backgroundColor: (notice.tone === 'error' ? colors.red : colors.accent) + '15' }]}>
      <Text style={[styles.bannerText, { color: notice.tone === 'error' ? colors.red : colors.textPrimary }]}>{notice.text}</Text>
      <TouchableOpacity onPress={() => setNotice(null)} accessibilityLabel="Dismiss">
        <X size={16} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  ) : null;

  let connectionBanner: React.ReactNode = null;
  if (status === 'error' || status === 'connecting' || status === 'signed-out') {
    const isError = status !== 'connecting';
    const tint = isError ? colors.red : colors.amber;
    connectionBanner = (
      <View style={[styles.banner, { borderColor: tint + '55', backgroundColor: tint + '15' }]}>
        <WifiOff size={16} color={tint} />
        <Text style={[styles.bannerText, { color: tint }]}>
          {status === 'connecting'
            ? 'Connecting to the server...'
            : status === 'signed-out'
              ? 'You are signed out. Sign in again to see live sessions.'
              : `Cannot reach the server${statusDetail ? `: ${statusDetail}` : '.'}`}
        </Text>
      </View>
    );
  } else if (statusDetail) {
    // Connected, but the server said this account is not an administrator
    connectionBanner = (
      <View style={[styles.banner, { borderColor: colors.amber + '55', backgroundColor: colors.amber + '15' }]}>
        <AlertTriangle size={16} color={colors.amber} />
        <Text style={[styles.bannerText, { color: colors.amber }]}>{statusDetail}</Text>
      </View>
    );
  }

  const listHeader = (
    <View style={{ gap: 12, marginBottom: 4 }}>
      {connectionBanner}
      {noticeBanner}
      <View style={styles.statsGrid}>
        {stats.map((stat, i) => (
          <Animated.View key={stat.label} entering={FadeInDown.delay(i * 40).springify()} style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.metricLabel, { color: colors.textDim, marginBottom: 4 }]}>{stat.label}</Text>
            <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
          </Animated.View>
        ))}
      </View>
      <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Search size={16} color={colors.textDim} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by host or room"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.searchInput, { color: colors.textPrimary }]}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search">
            <X size={16} color={colors.textDim} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderItem = ({ item, index }: { item: any, index: number }) => {
    const risk = item.riskScore || 0;
    return (
      <Animated.View entering={FadeInDown.delay(index * 50).springify()} layout={LinearTransition.springify()}>
        <AnimatedPressable hapticFeedback="light" onPress={() => setSelectedId(item.id)}>
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }, risk >= 70 && { borderColor: isDark ? 'rgba(255, 59, 92, 0.4)' : 'rgba(255, 59, 92, 0.3)' }]}>
            <View style={styles.cardInner}>
              <View style={[styles.statusIndicator, { backgroundColor: riskColor(risk), shadowColor: riskColor(risk) }]} />

              <View style={styles.sessionInfo}>
                <Text style={[styles.sessionHost, { color: colors.textPrimary }]} numberOfLines={1}>{item.host || 'Unknown Host'}</Text>
                <Text style={[styles.sessionDetail, { color: colors.accent }]}>Room {item.id}</Text>
                <Text style={[styles.sessionDetail, { color: colors.textDim, marginTop: 2 }]}>
                  {item.controllerCount || 0} controller(s) | {formatDuration(item.durationSeconds)}
                </Text>
              </View>

              <View style={styles.metrics}>
                <View style={[styles.riskBadge, { backgroundColor: riskColor(risk) + (isDark ? '1a' : '0d'), borderColor: riskColor(risk) + (isDark ? '4d' : '26') }]}>
                  <Text style={[styles.riskText, { color: riskColor(risk) }]}>RISK {risk}</Text>
                </View>
                <Text style={[styles.sessionMode, { color: colors.textSecondary }]}>{item.mode === 'supervised' ? 'SUPERVISED' : 'COLLAB'}</Text>
                <Text style={[styles.sessionMode, { color: statusColor(item.status) }]}>{String(item.status || 'live').toUpperCase()}</Text>
              </View>
            </View>
          </View>
        </AnimatedPressable>
      </Animated.View>
    );
  };

  const ListEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconBox, { backgroundColor: isDark ? 'rgba(0, 212, 255, 0.1)' : 'rgba(0, 212, 255, 0.05)', borderColor: isDark ? 'rgba(0, 212, 255, 0.3)' : 'rgba(0, 212, 255, 0.1)' }]}>
        <Activity size={48} color={colors.accent} style={isDark && styles.glowAccent} />
      </View>
      <Text style={[styles.emptyText, { color: colors.textPrimary }]}>{query ? 'No matching sessions' : 'No active sessions'}</Text>
      <Text style={[styles.emptySubtext, { color: colors.textDim }]}>{query ? 'Try another host or room code.' : 'Rooms appear here as soon as they start.'}</Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.baseBg, { backgroundColor: colors.bg }]} />

      <ImageBackground
        source={require('../../assets/images/grid.svg')}
        style={styles.gridBg}
        imageStyle={{ opacity: isDark ? 0.08 : 0.03, resizeMode: 'repeat' }}
      />

      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Live Sessions</Text>
          <TouchableOpacity onPress={toggleTheme} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {isDark ? <Sun size={16} color={colors.textSecondary} /> : <Moon size={16} color={colors.textSecondary} />}
          </TouchableOpacity>
        </View>

        {liveSessions === null ? (
          <View style={{ paddingTop: 16, gap: 12 }}>
            {connectionBanner}
            <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 40 }} />
            <Text style={[styles.emptySubtext, { color: colors.textDim, textAlign: 'center' }]}>Loading sessions...</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item: any) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContainer}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={ListEmpty}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={!!selectedSession}
        onRequestClose={() => setSelectedId(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { borderColor: colors.borderBright, backgroundColor: colors.surface }]}>
            {selectedSession && (
              <>
                <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                  <View style={{ flexShrink: 1 }}>
                    <Text style={[styles.modalSubtitle, { color: colors.textDim }]}>ROOM {selectedSession.id}</Text>
                    <Text style={[styles.modalTitle, { color: colors.textPrimary }]} numberOfLines={1}>{selectedSession.host}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedId(null)} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
                    <X size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {notice && <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>{noticeBanner}</View>}

                <ScrollView style={{ maxHeight: 520 }}>
                <View style={[styles.gridContainer, { borderBottomColor: colors.border }]}>
                  <View style={styles.gridRow}>
                    <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>MODE</Text>
                      <Text style={[styles.metricValue, { color: colors.textPrimary }]}>{selectedSession.mode === 'supervised' ? 'Supervised' : 'Collaboration'}</Text>
                    </View>
                    <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>ACCESS</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Bolt size={14} color={colors.accent} />
                        <Text style={[styles.metricValue, { color: colors.accent }, isDark && { textShadowColor: 'rgba(0,212,255,0.5)', textShadowRadius: 10 }]}>
                          {selectedSession.permission?.toUpperCase() || 'FULL'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.gridRow}>
                    <View style={[styles.metricCard, { backgroundColor: riskColor(selectedSession.riskScore || 0) + (isDark ? '1a' : '0d'), borderColor: riskColor(selectedSession.riskScore || 0) + (isDark ? '4d' : '26') }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>RISK SCORE</Text>
                      <Text style={[styles.metricValue, { color: riskColor(selectedSession.riskScore || 0) }]}>
                        {selectedSession.riskScore || 0}
                      </Text>
                    </View>
                    <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>OBSERVERS</Text>
                      <Text style={[styles.metricValue, { color: colors.textPrimary }]}>{selectedSession.observerCount || 0}</Text>
                    </View>
                  </View>
                  <View style={[styles.gridRow, { marginBottom: 0 }]}>
                    <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>DURATION</Text>
                      <Text style={[styles.metricValue, { color: colors.textPrimary, fontSize: 16 }]}>{formatDuration(selectedSession.durationSeconds)}</Text>
                    </View>
                    <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>STATUS</Text>
                      <Text style={[styles.metricValue, { color: statusColor(selectedSession.status), fontSize: 16 }]}>{String(selectedSession.status || 'live').toUpperCase()}</Text>
                    </View>
                  </View>
                </View>

                <View style={[styles.infoBox, { borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 }]}>
                  <Text style={[styles.metricLabel, { color: colors.textDim }]}>OBSERVATION POLICY</Text>
                  <Text style={[styles.infoText, { color: colors.textSecondary, marginTop: 0 }]}>
                    {selectedSession.mode === 'supervised'
                      ? 'This session enforces visible observation. Both host and controllers are notified when you begin monitoring.'
                      : 'This is a collaboration room. Observation requires host approval.'}
                  </Text>
                  <AnimatedPressable
                    hapticFeedback="light"
                    onPress={() => setObservation({ roomId: selectedSession.id })}
                    style={[styles.actionBtnPrimary, { backgroundColor: colors.accent + '15', borderColor: colors.accent + '55' }]}
                  >
                    <Eye size={14} color={colors.accent} style={{ marginRight: 8 }} />
                    <Text style={[styles.actionBtnPrimaryText, { color: colors.accent }]}>VIEW HOST SCREEN</Text>
                  </AnimatedPressable>
                  {/*
                    "Join as Administrator" (the web's /session?room=...&role=admin) is intentionally not offered here:
                    app/session/[code].tsx only reads the `code` route param and always emits
                    join-room(code, 'controller', meta), so it cannot join with the 'admin' role. Opening it would make
                    the administrator an ordinary controller asking the host for access. Add the button once that screen
                    supports an admin role.
                  */}

                  <Text style={[styles.metricLabel, { color: colors.textDim, marginTop: 6 }]}>INTERVENTIONS</Text>
                  <View style={styles.actionGrid}>
                    <TouchableOpacity onPress={() => revokeAccess(selectedSession.id)} style={[styles.gridBtn, { borderColor: colors.border }]}>
                      <ShieldOff size={14} color={colors.amber} /><Text style={[styles.gridBtnText, { color: colors.textPrimary }]}>Revoke all access</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => openWarning(selectedSession.id)} style={[styles.gridBtn, { borderColor: colors.amber + '55' }]}>
                      <AlertTriangle size={14} color={colors.amber} /><Text style={[styles.gridBtnText, { color: colors.amber }]}>Send warning</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={!selectedSession.controllerCount} onPress={() => removeAllControllers(selectedSession)} style={[styles.gridBtn, { borderColor: colors.border, opacity: selectedSession.controllerCount ? 1 : 0.4 }]}>
                      <UserMinus size={14} color={colors.amber} /><Text style={[styles.gridBtnText, { color: colors.textPrimary }]}>Remove all controllers</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => banHost(selectedSession.id)} style={[styles.gridBtn, { borderColor: colors.red + '55' }]}>
                      <Ban size={14} color={colors.red} /><Text style={[styles.gridBtnText, { color: colors.red }]}>Ban host</Text>
                    </TouchableOpacity>
                  </View>
                  <AnimatedPressable
                    hapticFeedback="medium"
                    style={[styles.actionBtnPrimary, { backgroundColor: colors.red + (isDark ? '1a' : '0d'), borderColor: colors.red + (isDark ? '4d' : '26') }]}
                    onPress={() => terminateSession(selectedSession.id)}
                  >
                    <Square size={14} color={colors.red} style={{ marginRight: 8 }} />
                    <Text style={[styles.actionBtnPrimaryText, { color: colors.red }]}>TERMINATE SESSION</Text>
                  </AnimatedPressable>

                  {!!(selectedSession.controllers || []).length && (
                    <Text style={[styles.metricLabel, { color: colors.textDim, marginTop: 6 }]}>CONTROLLER TARGETS</Text>
                  )}
                  {(selectedSession.controllers || []).map((controller: any) => (
                    <View key={controller.id} style={[styles.controllerCard, { borderColor: colors.border }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <View style={{ flexShrink: 1 }}>
                          <Text style={[styles.controllerName, { color: colors.textPrimary }]} numberOfLines={1}>{controller.name}</Text>
                          <Text style={[styles.controllerMeta, { color: colors.textDim }]} numberOfLines={1}>{controller.email || 'No email'} | {controller.quality?.health || 'unknown'}</Text>
                        </View>
                        <Text style={[styles.controllerMeta, { color: colors.accent }]}>{String(controller.permission || '').toUpperCase()}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
                        <TouchableOpacity onPress={() => revokeAccess(selectedSession.id, controller.id)}><Text style={[styles.linkBtn, { color: colors.amber }]}>Revoke</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => removeController(selectedSession.id, controller.id)}><Text style={[styles.linkBtn, { color: colors.amber }]}>Remove</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => banController(selectedSession.id, controller)}><Text style={[styles.linkBtn, { color: colors.red }]}>Ban</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => setObservation({ roomId: selectedSession.id, targetId: controller.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Camera size={12} color={colors.accent} /><Text style={[styles.linkBtn, { color: colors.accent }]}>Feed</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>

                <View style={[styles.infoBox, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[styles.metricLabel, { color: colors.textDim }]}>EVIDENCE GALLERY</Text>
                  {(selectedSession.evidence || []).length ? (
                    <View style={styles.gallery}>
                      {[...selectedSession.evidence].reverse().map((ev: any) => (
                        <TouchableOpacity key={ev.id} disabled={!ev.url} onPress={() => setViewerUri(uploadUri(ev.url))} style={[styles.galleryItem, { borderColor: colors.border }]}>
                          {ev.url ? (
                            <Image source={{ uri: uploadUri(ev.url)! }} style={styles.galleryImage} resizeMode="cover" />
                          ) : (
                            <View style={[styles.galleryImage, { alignItems: 'center', justifyContent: 'center' }]}><Text style={[styles.controllerMeta, { color: colors.textDim }]}>No image</Text></View>
                          )}
                          <Text style={[styles.controllerMeta, { color: colors.red, padding: 6 }]} numberOfLines={1}>{ev.label || 'Violation detected'}</Text>
                          <Text style={[styles.controllerMeta, { color: colors.textDim, paddingHorizontal: 6, paddingBottom: 6 }]}>{ev.time}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <Text style={[styles.infoText, { color: colors.textDim }]}>No visual evidence captured.</Text>
                  )}

                  <Text style={[styles.metricLabel, { color: colors.textDim, marginTop: 16 }]}>SESSION RECORDINGS</Text>
                  {(selectedSession.recordings || []).length ? (
                    (selectedSession.recordings as string[]).map((url, i) => (
                      <TouchableOpacity key={url} onPress={() => Linking.openURL(uploadUri(url)!)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                        <Film size={14} color={colors.accent} />
                        <Text style={[styles.linkBtn, { color: colors.accent }]}>Recording chunk {i + 1}</Text>
                      </TouchableOpacity>
                    ))
                  ) : (
                    <Text style={[styles.infoText, { color: colors.textDim }]}>No recordings available.</Text>
                  )}
                </View>

                <View style={[styles.infoBox, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <Text style={[styles.metricLabel, { color: colors.textDim }]}>ACTIVITY TIMELINE</Text>
                  {(selectedSession.events || []).length ? (
                    [...selectedSession.events].reverse().slice(0, 20).map((event: any, i: number) => (
                      <View key={i} style={[styles.timelineItem, { borderColor: colors.border }]}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={[styles.controllerMeta, { color: colors.textDim }]}>{String(event.type).toUpperCase()}</Text>
                          <Text style={[styles.controllerMeta, { color: colors.textDim }]}>{event.time}</Text>
                        </View>
                        <Text style={[styles.timelineText, { color: colors.textSecondary }]}>{event.message}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.infoText, { color: colors.textDim }]}>No room events recorded yet.</Text>
                  )}
                  {!!selectedSession.latestTxHash && (
                    <View style={styles.anchorRow}>
                      <Text style={[styles.controllerMeta, { color: colors.textSecondary }]}>LATEST AUDIT ANCHOR</Text>
                      <TouchableOpacity onPress={() => shareHash(String(selectedSession.latestTxHash))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel="Share audit anchor hash">
                        <Link2 size={12} color={colors.accent} />
                        <Text selectable style={[styles.controllerMeta, { color: colors.accent }]}>{shortHash(String(selectedSession.latestTxHash))}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                {selectedSession.mode === 'supervised' && selectedSession.federated && (
                  <View style={[styles.infoBox, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Brain size={14} color={colors.violet} />
                      <Text style={[styles.metricLabel, { color: colors.textDim, marginBottom: 0 }]}>FEDERATED LEARNING (SECURE AGGREGATION)</Text>
                    </View>
                    <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                      {selectedSession.federated.phase && selectedSession.federated.phase !== 'idle'
                        ? `Round ${selectedSession.federated.round} in progress (${selectedSession.federated.phase}, ${selectedSession.federated.pendingContributors} participant(s))`
                        : selectedSession.federated.lastAggregate
                          ? `Last round ${selectedSession.federated.lastAggregate.round}: ${selectedSession.federated.lastAggregate.contributorCount} participant(s), ${selectedSession.federated.lastAggregate.sampleCount} sample(s)`
                          : 'No completed rounds yet'}
                    </Text>
                  </View>
                )}

                <View style={[styles.infoBox, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                  <AuditIntegrity sessionId={selectedSession.id} />
                </View>

                <View style={styles.infoBox}>
                  <Text style={[styles.metricLabel, { color: colors.red }]}>DANGER ZONE</Text>
                  <Text style={[styles.infoText, { color: colors.textSecondary, marginTop: 0, marginBottom: 10 }]}>
                    Code Black permanently deletes every recording and evidence file for this room. The purge and its reason are recorded on the audit chain.
                  </Text>
                  <TouchableOpacity onPress={() => openPurge(selectedSession.id)} style={[styles.actionBtnPrimary, { backgroundColor: colors.red, borderColor: colors.red }]}>
                    <Trash2 size={14} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={[styles.actionBtnPrimaryText, { color: '#fff' }]}>CODE BLACK: PURGE RECORDINGS</Text>
                  </TouchableOpacity>
                </View>
                </ScrollView>
              </>
            )}
          </View>
        </View>

        {/* Rendered inside the drawer's Modal so iOS can present them on top of it */}
        <Modal visible={!!warnRoom} transparent animationType="fade" onRequestClose={() => setWarnRoom(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
            <View style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.borderBright }]}>
              <Text style={[styles.dialogTitle, { color: colors.textPrimary }]}>Send warning</Text>
              <Text style={[styles.infoText, { color: colors.textSecondary, marginTop: 0 }]}>Everyone in room {warnRoom} sees this message.</Text>
              <TextInput
                value={warnText}
                onChangeText={setWarnText}
                multiline
                autoFocus
                style={[styles.dialogInput, { minHeight: 90, color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.bg }]}
                placeholder="Warning message"
                placeholderTextColor={colors.textDim}
              />
              <View style={styles.dialogActions}>
                <TouchableOpacity onPress={() => setWarnRoom(null)} style={[styles.dialogBtn, { borderColor: colors.border }]}>
                  <Text style={[styles.gridBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={!warnText.trim()} onPress={sendWarning} style={[styles.dialogBtn, { borderColor: colors.amber, backgroundColor: colors.amber + '20', opacity: warnText.trim() ? 1 : 0.4 }]}>
                  <Text style={[styles.gridBtnText, { color: colors.amber }]}>Send warning</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={!!purgeRoom} transparent animationType="fade" onRequestClose={() => setPurgeRoom(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
            <View style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.red }]}>
              <Text style={[styles.dialogTitle, { color: colors.red }]}>Code Black</Text>
              <Text style={[styles.infoText, { color: colors.textSecondary, marginTop: 0 }]}>
                This permanently deletes every recording and evidence file for room {purgeRoom}. Type the room code to confirm.
              </Text>
              <TextInput
                value={purgeCode}
                onChangeText={setPurgeCode}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder={purgeRoom || 'Room code'}
                placeholderTextColor={colors.textDim}
                style={[styles.dialogInput, { color: colors.textPrimary, borderColor: purgeCode && purgeCode.trim() !== purgeRoom ? colors.red : colors.border, backgroundColor: colors.bg, fontFamily: 'SpaceMono' }]}
              />
              <TextInput
                value={purgeReason}
                onChangeText={setPurgeReason}
                multiline
                placeholder="Reason (recorded on the audit chain, at least 5 characters)"
                placeholderTextColor={colors.textDim}
                style={[styles.dialogInput, { minHeight: 70, color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.bg }]}
              />
              <View style={styles.dialogActions}>
                <TouchableOpacity onPress={() => setPurgeRoom(null)} style={[styles.dialogBtn, { borderColor: colors.border }]}>
                  <Text style={[styles.gridBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={!purgeReady} onPress={requestPurge} style={[styles.dialogBtn, { borderColor: colors.red, backgroundColor: colors.red, opacity: purgeReady ? 1 : 0.4 }]}>
                  <Text style={[styles.gridBtnText, { color: '#fff' }]}>Purge</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <ObserverView roomId={observation?.roomId ?? null} targetId={observation?.targetId ?? null} onClose={() => setObservation(null)} />

        <Modal visible={!!viewerUri} animationType="fade" transparent={true} onRequestClose={() => setViewerUri(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' }}>
            {viewerUri && <Image source={{ uri: viewerUri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}
            <TouchableOpacity onPress={() => setViewerUri(null)} style={{ position: 'absolute', top: Platform.OS === 'ios' ? 60 : 30, right: 20, padding: 10 }}>
              <X size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </Modal>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  baseBg: { ...StyleSheet.absoluteFill },
  gridBg: { ...StyleSheet.absoluteFill },
  content: { flex: 1, padding: 16, zIndex: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 40, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  iconBtn: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  listContainer: { paddingTop: 16, paddingBottom: 100, gap: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  bannerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { flexBasis: '47%', flexGrow: 1, padding: 12, borderRadius: 12, borderWidth: 1 },
  statValue: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontSize: 14, fontFamily: 'Inter_500Medium' },
  card: { borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  cardInner: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  statusIndicator: { width: 12, height: 12, borderRadius: 6, marginRight: 16, shadowOpacity: 0.8, shadowRadius: 8 },
  sessionInfo: { flex: 1 },
  sessionHost: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  sessionDetail: { fontSize: 12, fontFamily: 'SpaceMono' },
  metrics: { alignItems: 'flex-end', gap: 6 },
  riskBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  riskText: { fontSize: 10, fontFamily: 'SpaceMono' },
  sessionMode: { fontSize: 10, fontFamily: 'SpaceMono' },
  emptyContainer: { padding: 40, alignItems: 'center', marginTop: 24 },
  emptyIconBox: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1 },
  glowAccent: { shadowColor: '#00d4ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 5 },
  emptyText: { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  emptySubtext: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.7)', padding: 16 },
  modalContent: { width: '100%', borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, borderBottomWidth: 1 },
  modalTitle: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  modalSubtitle: { fontSize: 12, fontFamily: 'SpaceMono', marginBottom: 4, letterSpacing: 1 },
  closeBtn: { padding: 8, borderRadius: 8 },
  gridContainer: { padding: 16, borderBottomWidth: 1 },
  gridRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  metricCard: { flex: 1, padding: 16, borderRadius: 12, borderWidth: 1 },
  metricLabel: { fontSize: 10, fontFamily: 'SpaceMono', marginBottom: 8, letterSpacing: 1 },
  metricValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  infoBox: { padding: 24 },
  infoText: { fontSize: 14, lineHeight: 20, marginTop: 8, fontFamily: 'Inter_500Medium' },
  actionBtnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 12, borderWidth: 1 },
  actionBtnPrimaryText: { fontSize: 14, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridBtn: { flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 8, borderWidth: 1 },
  gridBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', flexShrink: 1 },
  controllerCard: { borderWidth: 1, borderRadius: 8, padding: 10 },
  controllerName: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  controllerMeta: { fontSize: 10, fontFamily: 'SpaceMono' },
  linkBtn: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  galleryItem: { width: '48%', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  galleryImage: { width: '100%', aspectRatio: 16 / 9 },
  timelineItem: { borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 6 },
  timelineText: { fontSize: 12, marginTop: 4, fontFamily: 'Inter_500Medium' },
  anchorRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  dialog: { width: '100%', borderRadius: 12, borderWidth: 1, padding: 20, gap: 12 },
  dialogTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  dialogInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, textAlignVertical: 'top' },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  dialogBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
});
