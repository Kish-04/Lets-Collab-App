import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, ImageBackground, TouchableOpacity, Alert, Modal, Platform, ScrollView, Image, Linking } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { BACKEND_URL, getStoredAuthToken } from '../../lib/api';
import { X, Activity, Bolt, Sun, Moon, Brain, AlertTriangle, Eye, ShieldOff, UserMinus, Ban, Film } from 'lucide-react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { AuditIntegrity } from '../../components/AuditIntegrity';
import { ObserverView } from '../../components/ObserverView';

// Evidence and recording URLs from the server are signed, short-lived /uploads paths
const uploadUri = (url?: string) => (url ? (url.startsWith('http') ? url : `${BACKEND_URL}${url}`) : null);
import io, { Socket } from 'socket.io-client';
import { useFocusEffect } from 'expo-router';

export default function SessionsScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [observeRoomId, setObserveRoomId] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      const connectSocket = async () => {
        const token = await getStoredAuthToken();
        if (!token || !isMounted) return;

        const socket = io(BACKEND_URL, {
          auth: { token },
          transports: ['websocket', 'polling'],
          timeout: 10000,
        });

        socket.on('connect', () => {
          console.log('Admin socket connected');
          socket.emit('get-sessions');
          setLoading(false);
        });

        socket.on('connect_error', (error) => {
          console.log('Admin socket connect_error:', error);
          if (isMounted) {
            setLoading(false);
          }
        });

        // The server pushes 'sessions-update' to the admins room on every change
        socket.on('sessions-update', (updatedSessions: any[]) => {
          if (!isMounted) return;
          setSessions(updatedSessions);
          setSelectedSession((current: any) => current ? updatedSessions.find(session => session.id === current.id) ?? null : null);
        });

        socket.on('admin-action-complete', ({ message }: { message: string }) => Alert.alert('Done', message));
        socket.on('admin-error', (message: string) => Alert.alert('Admin action failed', String(message)));

        socketRef.current = socket;
      };

      connectSocket();

      return () => {
        isMounted = false;
        if (socketRef.current) {
          socketRef.current.disconnect();
          socketRef.current = null;
        }
      };
    }, [])
  );

  const terminateSession = () => {
    if (!socketRef.current || !selectedSession) return;
    const roomId = selectedSession.id;

    Alert.alert("Confirm Termination", "Are you sure you want to forcibly terminate this session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Terminate",
        style: "destructive",
        onPress: () => {
          socketRef.current?.emit('kill-session', roomId);
          setSelectedSession(null);
        }
      }
    ]);
  };

  // Same socket interventions as the web dashboard (server/index.js admin-* handlers)
  const intervene = (label: string, emit: () => void) => {
    Alert.alert(label, 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: label, style: 'destructive', onPress: emit },
    ]);
  };
  const revokeAccess = (roomId: string, targetId?: string) =>
    intervene('Revoke access', () => socketRef.current?.emit('admin-revoke-access', roomId, targetId));
  const removeController = (roomId: string, targetId?: string) =>
    intervene('Remove controller', () => socketRef.current?.emit('admin-remove-controller', { roomId, targetId }));
  const banParticipant = (roomId: string, target: 'host' | 'controller', targetId?: string) =>
    intervene(target === 'host' ? 'Ban host' : 'Ban controller', () => socketRef.current?.emit('admin-ban-participant', { roomId, target, targetId }));

  const warnSession = () => {
    if (!socketRef.current || !selectedSession) return;
    socketRef.current.emit('admin-warn-user', {
      roomId: selectedSession.id,
      message: 'Warning from administrator: Please return your attention to the session.',
    });
    Alert.alert('Warning sent', `Everyone in room ${selectedSession.id} has been warned.`);
  };

  const isDark = theme === 'dark' || theme === 'glassmorphic';
  const renderItem = ({ item, index }: { item: any, index: number }) => (
    <Animated.View entering={FadeInDown.delay(index * 50).springify()} layout={LinearTransition.springify()}>
      <AnimatedPressable hapticFeedback="light" onPress={() => setSelectedSession(item)}>
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }, item.riskScore >= 70 && { borderColor: isDark ? 'rgba(255, 59, 92, 0.4)' : 'rgba(255, 59, 92, 0.3)' }]}>
          <View style={styles.cardInner}>
            <View style={[styles.statusIndicator, { backgroundColor: item.riskScore >= 70 ? colors.red : item.riskScore >= 30 ? colors.amber : colors.emerald, shadowColor: item.riskScore >= 70 ? colors.red : item.riskScore >= 30 ? colors.amber : colors.emerald }]} />
            
            <View style={styles.sessionInfo}>
              <Text style={[styles.sessionHost, { color: colors.textPrimary }]}>{item.host || 'Unknown Host'}</Text>
              <Text style={[styles.sessionDetail, { color: colors.textDim }]}>Room: {item.id}</Text>
            </View>
            
            <View style={styles.metrics}>
              <View style={[styles.riskBadge, { backgroundColor: item.riskScore >= 70 ? (isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)') : item.riskScore >= 30 ? (isDark ? 'rgba(240,165,0,0.1)' : 'rgba(240,165,0,0.05)') : (isDark ? 'rgba(0,196,140,0.1)' : 'rgba(0,196,140,0.05)'), borderColor: item.riskScore >= 70 ? (isDark ? 'rgba(255,59,92,0.3)' : 'rgba(255,59,92,0.15)') : item.riskScore >= 30 ? (isDark ? 'rgba(240,165,0,0.3)' : 'rgba(240,165,0,0.15)') : (isDark ? 'rgba(0,196,140,0.3)' : 'rgba(0,196,140,0.15)') }]}>
                <Text style={[styles.riskText, { color: item.riskScore >= 70 ? colors.red : item.riskScore >= 30 ? colors.amber : colors.emerald }]}>
                  RISK {item.riskScore}
                </Text>
              </View>
              <Text style={[styles.sessionMode, { color: colors.textSecondary }]}>{item.mode === 'supervised' ? 'SUPERVISED' : 'COLLAB'}</Text>
            </View>
          </View>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );

  const ListEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconBox, { backgroundColor: isDark ? 'rgba(0, 212, 255, 0.1)' : 'rgba(0, 212, 255, 0.05)', borderColor: isDark ? 'rgba(0, 212, 255, 0.3)' : 'rgba(0, 212, 255, 0.1)' }]}>
        <Activity size={48} color={colors.accent} style={isDark && styles.glowAccent} />
      </View>
      <Text style={[styles.emptyText, { color: colors.textPrimary }]}>No active sessions</Text>
      <Text style={[styles.emptySubtext, { color: colors.textDim }]}>Waiting for WebRTC connections...</Text>
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
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Live Operations</Text>
          <TouchableOpacity onPress={toggleTheme} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {isDark ? <Sun size={16} color={colors.textSecondary} /> : <Moon size={16} color={colors.textSecondary} />}
          </TouchableOpacity>
        </View>
        
        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 50 }} />
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item: any) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={ListEmpty}
          />
        )}
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={!!selectedSession}
        onRequestClose={() => setSelectedSession(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { borderColor: colors.borderBright, backgroundColor: colors.surface }]}>
            {selectedSession && (
              <>
                <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                  <View>
                    <Text style={[styles.modalSubtitle, { color: colors.textDim }]}>ROOM {selectedSession.id}</Text>
                    <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{selectedSession.host}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedSession(null)} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
                    <X size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

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
                    <View style={[styles.metricCard, { backgroundColor: selectedSession.riskScore >= 70 ? (isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)') : selectedSession.riskScore >= 30 ? (isDark ? 'rgba(240,165,0,0.1)' : 'rgba(240,165,0,0.05)') : (isDark ? 'rgba(0,196,140,0.1)' : 'rgba(0,196,140,0.05)'), borderColor: selectedSession.riskScore >= 70 ? (isDark ? 'rgba(255,59,92,0.3)' : 'rgba(255,59,92,0.15)') : selectedSession.riskScore >= 30 ? (isDark ? 'rgba(240,165,0,0.3)' : 'rgba(240,165,0,0.15)') : (isDark ? 'rgba(0,196,140,0.3)' : 'rgba(0,196,140,0.15)') }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>RISK SCORE</Text>
                      <Text style={[styles.metricValue, selectedSession.riskScore >= 70 ? { color: colors.red } : selectedSession.riskScore >= 30 ? { color: colors.amber } : { color: colors.emerald }]}>
                        {selectedSession.riskScore}
                      </Text>
                    </View>
                    <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>OBSERVERS</Text>
                      <Text style={[styles.metricValue, { color: colors.textPrimary }]}>{selectedSession.observerCount || 0}</Text>
                    </View>
                  </View>
                </View>

                <ScrollView style={{ maxHeight: 440 }}>
                <View style={[styles.infoBox, { borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 }]}>
                  <AnimatedPressable
                    hapticFeedback="light"
                    onPress={() => setObserveRoomId(selectedSession.id)}
                    style={[styles.actionBtnPrimary, { backgroundColor: colors.accent + '15', borderColor: colors.accent + '55' }]}
                  >
                    <Eye size={14} color={colors.accent} style={{ marginRight: 8 }} />
                    <Text style={[styles.actionBtnPrimaryText, { color: colors.accent }]}>VIEW HOST SCREEN</Text>
                  </AnimatedPressable>

                  <Text style={[styles.metricLabel, { color: colors.textDim, marginTop: 6 }]}>INTERVENTIONS</Text>
                  <View style={styles.actionGrid}>
                    <TouchableOpacity onPress={() => revokeAccess(selectedSession.id)} style={[styles.gridBtn, { borderColor: colors.border }]}>
                      <ShieldOff size={14} color={colors.amber} /><Text style={[styles.gridBtnText, { color: colors.textPrimary }]}>Revoke access</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={!selectedSession.controllerCount} onPress={() => removeController(selectedSession.id)} style={[styles.gridBtn, { borderColor: colors.border, opacity: selectedSession.controllerCount ? 1 : 0.4 }]}>
                      <UserMinus size={14} color={colors.amber} /><Text style={[styles.gridBtnText, { color: colors.textPrimary }]}>Remove controller</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={!selectedSession.controllerCount} onPress={() => banParticipant(selectedSession.id, 'controller')} style={[styles.gridBtn, { borderColor: colors.red + '55', opacity: selectedSession.controllerCount ? 1 : 0.4 }]}>
                      <Ban size={14} color={colors.red} /><Text style={[styles.gridBtnText, { color: colors.red }]}>Ban controller</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => banParticipant(selectedSession.id, 'host')} style={[styles.gridBtn, { borderColor: colors.red + '55' }]}>
                      <Ban size={14} color={colors.red} /><Text style={[styles.gridBtnText, { color: colors.red }]}>Ban host</Text>
                    </TouchableOpacity>
                  </View>

                  {(selectedSession.controllers || []).map((controller: any) => (
                    <View key={controller.id} style={[styles.controllerCard, { borderColor: colors.border }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <View style={{ flexShrink: 1 }}>
                          <Text style={[styles.controllerName, { color: colors.textPrimary }]} numberOfLines={1}>{controller.name}</Text>
                          <Text style={[styles.controllerMeta, { color: colors.textDim }]} numberOfLines={1}>{controller.email || 'No email'} | {controller.quality?.health || 'unknown'}</Text>
                        </View>
                        <Text style={[styles.controllerMeta, { color: colors.accent }]}>{String(controller.permission || '').toUpperCase()}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                        <TouchableOpacity onPress={() => revokeAccess(selectedSession.id, controller.id)}><Text style={[styles.linkBtn, { color: colors.amber }]}>Revoke</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => removeController(selectedSession.id, controller.id)}><Text style={[styles.linkBtn, { color: colors.amber }]}>Remove</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => banParticipant(selectedSession.id, 'controller', controller.id)}><Text style={[styles.linkBtn, { color: colors.red }]}>Ban</Text></TouchableOpacity>
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
                  <Text style={[styles.metricLabel, { color: colors.textDim }]}>OBSERVATION POLICY</Text>
                  <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                    {selectedSession.mode === "supervised"
                      ? "Admin can enter observation immediately; the host sees a persistent observer badge."
                      : "Host approval is required before the admin receives the live screen."}
                  </Text>
                </View>
                </ScrollView>

                <View style={[styles.modalActions, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
                  <AnimatedPressable
                    hapticFeedback="light"
                    style={[styles.actionBtnPrimary, { marginBottom: 10, backgroundColor: colors.amber + '15', borderColor: colors.amber + '55' }]}
                    onPress={warnSession}
                  >
                    <AlertTriangle size={14} color={colors.amber} style={{ marginRight: 8 }} />
                    <Text style={[styles.actionBtnPrimaryText, { color: colors.amber }]}>WARN PARTICIPANTS</Text>
                  </AnimatedPressable>
                  <AnimatedPressable 
                    hapticFeedback="medium"
                    style={[styles.actionBtnPrimary, { backgroundColor: isDark ? 'rgba(255, 59, 92, 0.1)' : 'rgba(255, 59, 92, 0.05)', borderColor: isDark ? 'rgba(255, 59, 92, 0.3)' : 'rgba(255, 59, 92, 0.15)' }]}
                    onPress={terminateSession}
                  >
                    <Text style={[styles.actionBtnPrimaryText, { color: colors.red }]}>TERMINATE SESSION</Text>
                  </AnimatedPressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <ObserverView roomId={observeRoomId} onClose={() => setObserveRoomId(null)} />

      <Modal visible={!!viewerUri} animationType="fade" transparent={true} onRequestClose={() => setViewerUri(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' }}>
          {viewerUri && <Image source={{ uri: viewerUri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}
          <TouchableOpacity onPress={() => setViewerUri(null)} style={{ position: 'absolute', top: Platform.OS === 'ios' ? 60 : 30, right: 20, padding: 10 }}>
            <X size={24} color="#fff" />
          </TouchableOpacity>
        </View>
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
  listContainer: { paddingBottom: 100, gap: 12 },
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
  emptyContainer: { padding: 40, alignItems: 'center', marginTop: 40 },
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
  modalActions: { padding: 24, borderTopWidth: 1 },
  actionBtnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 12, borderWidth: 1 },
  actionBtnPrimaryText: { fontSize: 14, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridBtn: { flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 8, borderWidth: 1 },
  gridBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  controllerCard: { borderWidth: 1, borderRadius: 8, padding: 10 },
  controllerName: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  controllerMeta: { fontSize: 10, fontFamily: 'SpaceMono' },
  linkBtn: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  galleryItem: { width: '48%', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  galleryImage: { width: '100%', aspectRatio: 16 / 9 },
  timelineItem: { borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 6 },
  timelineText: { fontSize: 12, marginTop: 4, fontFamily: 'Inter_500Medium' },
});
