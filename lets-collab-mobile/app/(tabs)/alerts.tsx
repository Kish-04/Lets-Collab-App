import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, ImageBackground, TouchableOpacity, Modal, Platform, TextInput, Dimensions, Alert, Image, RefreshControl } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { BACKEND_URL } from '../../lib/api';
import { adminFetch, useAdminReports, useAdminSocket, useLiveSessions, useSocketEvent } from '../../lib/adminData';
import { shareExport, toCsv, writeExportFile } from '../../lib/exportFile';
import { ShieldAlert, X, Sun, Moon, Search, Download, Flag, CheckCircle, AlertTriangle, ImageOff, WifiOff, RefreshCw } from 'lucide-react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { PieChart } from 'react-native-chart-kit';

type FilterType = 'all' | 'high' | 'medium' | 'low';

type AlertEntry = {
  _id: string;
  time: string;
  roomId: string;
  eventType: string;
  message: string;
  penalty: number;
  totalRisk: number;
  flagged: boolean;
  falsePositive: boolean;
  evidenceUrl?: string;
  // Arrived live and was not stored by the server (database offline): kept across report refreshes
  liveOnly?: boolean;
};

const MAX_ALERTS = 200;

// Evidence URLs from the server are signed, short-lived /uploads paths
const evidenceUri = (url?: string) => (url ? (url.startsWith('http') ? url : `${BACKEND_URL}${url}`) : null);

// Running risk per room, oldest alert first, capped at 100 (the list itself is newest first)
function withRiskTotals(newestFirst: AlertEntry[]): AlertEntry[] {
  const totals = new Map<string, number>();
  const oldestFirst = [...newestFirst].reverse().map(alert => {
    const total = Math.min(100, (totals.get(alert.roomId) || 0) + alert.penalty);
    totals.set(alert.roomId, total);
    return { ...alert, totalRisk: total };
  });
  return oldestFirst.reverse();
}

function friendlyType(raw: string): string {
  const map: Record<string, string> = {
    NO_FACE: 'No face detected',
    MULTIPLE_FACES: 'Multiple faces',
    LOOKING_AWAY: 'Looking away',
    PHONE_DETECTED: 'Phone detected',
    BLURR_EVENT: 'Alt+Tab / blur',
    CLIPBOARD_CHANGE: 'Clipboard change',
    os_anticheat_violation: 'OS event',
    anticheat_violation: 'AI detection',
  };
  return map[raw] || raw;
}

const formatTime = (iso: string) => {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const shortRoom = (room: string) => (room.length >= 8 ? `${room.slice(0, 4)}·${room.slice(4, 8)}` : room);

export default function AlertsScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const { data: report, error: reportError, refresh } = useAdminReports();
  const { socket, connected, status, statusDetail } = useAdminSocket();
  const liveSessions = useLiveSessions();
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertEntry | null>(null);
  const [imageError, setImageError] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [warnRoomId, setWarnRoomId] = useState<string | null>(null);
  const [warnMessage, setWarnMessage] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const isDark = theme === 'dark' || theme === 'glassmorphic';
  const loaded = Boolean(report);

  // Stored alerts come from the shared, cached report; unsaved live alerts are kept on top
  useEffect(() => {
    if (!report) return;
    const stored: AlertEntry[] = (report.alerts || []).map((a: any) => ({
      _id: String(a._id),
      time: a.time || a.createdAt || new Date().toISOString(),
      roomId: a.room || 'SYSTEM',
      eventType: a.event || a.type || 'Unknown',
      message: a.message || '',
      penalty: a.penalty || 0,
      totalRisk: 0,
      flagged: Boolean(a.flagged),
      falsePositive: Boolean(a.falsePositive),
      evidenceUrl: a.evidenceUrl || undefined,
    }));
    setAlerts(prev => {
      const storedIds = new Set(stored.map(a => a._id));
      const unsaved = prev.filter(a => a.liveOnly && !storedIds.has(a._id));
      return withRiskTotals([...unsaved, ...stored].slice(0, MAX_ALERTS));
    });
    // Keep the open details in step with the refreshed copy (new signed evidence link, verdicts)
    setSelectedAlert(prev => {
      if (!prev) return prev;
      const fresh = stored.find(a => a._id === prev._id);
      return fresh ? { ...prev, ...fresh, totalRisk: prev.totalRisk } : prev;
    });
  }, [report]);

  // Live alerts on the shared connection
  useSocketEvent('system-alert', (payload: any) => {
    const entry: AlertEntry = {
      _id: payload?._id ? String(payload._id) : `live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time: payload?.time || new Date().toISOString(),
      roomId: payload?.room || payload?.roomId || 'SYSTEM',
      eventType: payload?.event || payload?.type || 'Unknown',
      message: payload?.message || '',
      penalty: payload?.penalty || 0,
      totalRisk: 0,
      flagged: false,
      falsePositive: false,
      evidenceUrl: payload?.evidenceUrl || undefined,
      liveOnly: !payload?._id,
    };
    setAlerts(prev => withRiskTotals([entry, ...prev.filter(a => a._id !== entry._id)].slice(0, MAX_ALERTS)));
  });

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 6000);
  };
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  useSocketEvent('admin-action-complete', (payload: { message?: string }) => showNotice(payload?.message || 'Done.'));
  useSocketEvent('admin-error', (message: any) => showNotice(typeof message === 'string' ? message : message?.message || 'The server refused the action.'));

  // Warn and Kill act on a live room; most alerts in the list belong to sessions that have ended
  const liveRoomIds = useMemo(() => new Set((liveSessions || []).map((session: any) => String(session.id))), [liveSessions]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };

  const updateAlertStatus = async (alert: AlertEntry, updates: { flagged?: boolean; falsePositive?: boolean }) => {
    if (alert.liveOnly) return;
    const id = alert._id;
    const previous = { flagged: alert.flagged, falsePositive: alert.falsePositive };
    const apply = (patch: Partial<AlertEntry>) => {
      setAlerts(prev => prev.map(a => (a._id === id ? { ...a, ...patch } : a)));
      setSelectedAlert(prev => (prev && prev._id === id ? { ...prev, ...patch } : prev));
    };
    // Optimistic update, rolled back if the server does not save it
    apply(updates);
    try {
      await adminFetch(`/api/admin/alerts/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch (err: any) {
      apply(previous);
      Alert.alert('Not saved', `This verdict could not be saved: ${err?.message || err}`);
    }
  };

  const openWarn = (roomId: string) => {
    setSelectedAlert(null);
    setWarnMessage('');
    // Let the details sheet close before another modal opens (iOS shows one modal at a time)
    setTimeout(() => setWarnRoomId(roomId), Platform.OS === 'ios' ? 350 : 0);
  };

  const submitWarning = () => {
    if (!warnRoomId) return;
    if (!socket || !connected) {
      showNotice('Not connected to the server, so the warning was not sent.');
      return;
    }
    const message = warnMessage.trim() || 'Warning from administrator.';
    socket.emit('admin-warn-user', { roomId: warnRoomId, message });
    showNotice(`Warning sent to everyone in room ${warnRoomId}.`);
    setWarnRoomId(null);
  };

  const handleKillSession = (roomId: string) => {
    Alert.alert('End session', `End room ${roomId} now? Everyone in it is disconnected.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End room',
        style: 'destructive',
        onPress: () => {
          if (!socket || !connected) {
            showNotice('Not connected to the server, so the room was not ended.');
            return;
          }
          socket.emit('kill-session', roomId);
          showNotice(`Room ${roomId} is being ended.`);
          setSelectedAlert(null);
        },
      },
    ]);
  };

  const filtered = alerts.filter(a => {
    const query = search.toLowerCase();
    const matchSearch =
      a.roomId.toLowerCase().includes(query) ||
      friendlyType(a.eventType).toLowerCase().includes(query) ||
      a.message.toLowerCase().includes(query);
    if (!matchSearch) return false;
    if (filter === 'high') return a.totalRisk >= 70;
    if (filter === 'medium') return a.totalRisk >= 30 && a.totalRisk < 70;
    if (filter === 'low') return a.totalRisk < 30;
    return true;
  });

  const exportCsv = async () => {
    try {
      const csv = toCsv(
        ['Time', 'Room', 'Alert Type', 'Message', 'Risk Delta', 'Total Risk', 'Flagged', 'False Positive'],
        filtered.map(a => [a.time, a.roomId, friendlyType(a.eventType), a.message, a.penalty, a.totalRisk, a.flagged, a.falsePositive]),
      );
      const uri = writeExportFile(`alerts_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`, csv);
      await shareExport(uri, 'CSV');
    } catch (err) {
      console.error(err);
      Alert.alert('Export Failed', 'Could not create the CSV file.');
    }
  };

  const typeCounts = alerts.reduce<Record<string, number>>((acc, a) => {
    const type = friendlyType(a.eventType);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const pieColors = [colors.amber, colors.violet, colors.accent, colors.emerald, colors.red];
  const pieData = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({
      name,
      population: value,
      color: pieColors[i % pieColors.length],
      legendFontColor: colors.textSecondary,
      legendFontSize: 12,
    }));

  // The list is newest first, so a room's first entry carries its latest running total
  const latestRiskByRoom = new Map<string, number>();
  for (const alert of alerts) if (!latestRiskByRoom.has(alert.roomId)) latestRiskByRoom.set(alert.roomId, alert.totalRisk);
  const topOffenders = Array.from(latestRiskByRoom.entries())
    .map(([room, score]) => ({ room, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const highCount = alerts.filter(a => a.totalRisk >= 70).length;

  const riskColor = (risk: number) => (risk >= 70 ? colors.red : risk >= 30 ? colors.amber : colors.emerald);

  const renderItem = ({ item }: { item: AlertEntry }) => {
    const isCritical = item.totalRisk >= 70;
    const isMedium = item.totalRisk >= 30 && item.totalRisk < 70;

    return (
      <AnimatedPressable hapticFeedback="light" onPress={() => { setImageError(false); setSelectedAlert(item); }} style={{ marginBottom: 12 }}>
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }, isCritical && { borderColor: isDark ? 'rgba(255, 59, 92, 0.4)' : 'rgba(255, 59, 92, 0.3)' }, item.falsePositive && { opacity: 0.6 }]}>
            <View style={styles.cardInner}>
              <View style={[styles.statusIndicator, { backgroundColor: riskColor(item.totalRisk), shadowColor: riskColor(item.totalRisk) }]} />

              <View style={styles.alertInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {item.flagged && <Flag size={12} color={colors.amber} />}
                  {item.falsePositive && <CheckCircle size={12} color={colors.emerald} />}
                  <Text style={[styles.alertType, { color: colors.textPrimary }]}>{friendlyType(item.eventType)}</Text>
                </View>
                <Text style={[styles.alertDetail, { color: colors.textDim }]} numberOfLines={1}>{item.message}</Text>
                <Text style={[styles.alertTime, { color: colors.textDim }]}>
                  {formatTime(item.time)} · <Text style={{ color: colors.accent }}>{shortRoom(item.roomId)}</Text>
                  {item.liveOnly ? ' · not stored' : ''}
                </Text>
              </View>

              <View style={styles.metrics}>
                <Text style={[styles.penaltyText, { color: colors.red }]}>+{item.penalty}</Text>
                <View style={[styles.riskBadge, { backgroundColor: isCritical ? (isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)') : isMedium ? (isDark ? 'rgba(240,165,0,0.1)' : 'rgba(240,165,0,0.05)') : (isDark ? 'rgba(0,196,140,0.1)' : 'rgba(0,196,140,0.05)'), borderColor: isCritical ? (isDark ? 'rgba(255,59,92,0.3)' : 'rgba(255,59,92,0.15)') : isMedium ? (isDark ? 'rgba(240,165,0,0.3)' : 'rgba(240,165,0,0.15)') : (isDark ? 'rgba(0,196,140,0.3)' : 'rgba(0,196,140,0.15)') }]}>
                  <Text style={[styles.riskText, { color: riskColor(item.totalRisk) }]}>
                    RISK {item.totalRisk}
                  </Text>
                </View>
              </View>
            </View>
          </View>
      </AnimatedPressable>
    );
  };

  const ListEmpty = () => {
    // A failed load is not "all clear"
    if (reportError && alerts.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconBox, { backgroundColor: isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)', borderColor: isDark ? 'rgba(255,59,92,0.3)' : 'rgba(255,59,92,0.15)' }]}>
            <AlertTriangle size={40} color={colors.red} />
          </View>
          <Text style={[styles.emptyText, { color: colors.textPrimary }]}>Alerts could not be loaded</Text>
          <Text style={[styles.emptySubtext, { color: colors.textDim, textAlign: 'center' }]}>{reportError}</Text>
        </View>
      );
    }
    const noneYet = alerts.length === 0;
    return (
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyIconBox, { backgroundColor: isDark ? 'rgba(0, 196, 140, 0.1)' : 'rgba(0, 196, 140, 0.05)', borderColor: isDark ? 'rgba(0, 196, 140, 0.3)' : 'rgba(0, 196, 140, 0.1)' }]}>
          <ShieldAlert size={48} color={colors.accent} style={isDark && styles.glowAccent} />
        </View>
        <Text style={[styles.emptyText, { color: colors.textPrimary }]}>{noneYet ? 'No alerts yet' : 'No matches'}</Text>
        <Text style={[styles.emptySubtext, { color: colors.textDim, textAlign: 'center' }]}>
          {noneYet ? 'No proctoring alerts have been recorded.' : 'No alerts match the current filter or search.'}
        </Text>
      </View>
    );
  };

  const connectionProblem =
    status === 'error' ? `Live alerts unavailable: ${statusDetail || 'could not reach the server'}`
      : status === 'signed-out' ? 'Signed out: live alerts are not received.'
        : status === 'connecting' && socket ? 'Reconnecting to the server: new alerts appear once connected.'
          : statusDetail || '';

  const selectedLive = selectedAlert ? liveRoomIds.has(selectedAlert.roomId) : false;
  const roomActionsEnabled = selectedLive && connected;
  const roomActionsHint = !selectedLive ? 'This room has ended' : !connected ? 'Not connected to the server' : '';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.baseBg, { backgroundColor: colors.bg }]} />

      <ImageBackground
        source={require('../../assets/images/grid.svg')}
        style={styles.gridBg}
        imageStyle={{ opacity: isDark ? 0.08 : 0.03, resizeMode: 'repeat' }}
      />

      <View style={styles.header}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Anti-Cheat Alerts</Text>
          {loaded && (
            <Text style={[styles.headerStats, { color: colors.textDim }]}>
              {alerts.length} total · <Text style={{ color: colors.red }}>{highCount} high-risk</Text>
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={toggleTheme} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {isDark ? <Sun size={16} color={colors.textSecondary} /> : <Moon size={16} color={colors.textSecondary} />}
        </TouchableOpacity>
      </View>

      {notice ? (
        <Animated.View entering={FadeInDown} exiting={FadeOut} style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
          <Text style={[styles.noticeText, { color: colors.textPrimary }]}>{notice}</Text>
          <TouchableOpacity onPress={() => setNotice('')} hitSlop={8}>
            <X size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </Animated.View>
      ) : null}

      {!loaded && !reportError ? (
        <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={ListEmpty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListHeaderComponent={
            <View style={styles.headerContent}>
              {reportError ? (
                <View style={[styles.banner, { borderColor: isDark ? 'rgba(255,59,92,0.4)' : 'rgba(255,59,92,0.3)', backgroundColor: isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)' }]}>
                  <AlertTriangle size={16} color={colors.red} />
                  <Text style={[styles.bannerText, { color: colors.red }]}>
                    {loaded ? `Showing the last loaded alerts. Refresh failed: ${reportError}` : `Could not load alerts: ${reportError}`}
                  </Text>
                  <TouchableOpacity onPress={onRefresh} hitSlop={8}>
                    <RefreshCw size={16} color={colors.red} />
                  </TouchableOpacity>
                </View>
              ) : null}
              {connectionProblem ? (
                <View style={[styles.banner, { borderColor: isDark ? 'rgba(240,165,0,0.4)' : 'rgba(240,165,0,0.3)', backgroundColor: isDark ? 'rgba(240,165,0,0.1)' : 'rgba(240,165,0,0.05)' }]}>
                  <WifiOff size={16} color={colors.amber} />
                  <Text style={[styles.bannerText, { color: colors.amber }]}>{connectionProblem}</Text>
                </View>
              ) : null}

              <View style={[styles.analyticsCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Violation Types</Text>
                {pieData.length > 0 ? (
                  <View>
                    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                      <PieChart
                        data={pieData}
                        width={Dimensions.get('window').width - 64}
                        height={160}
                        chartConfig={{ color: () => colors.textPrimary }}
                        accessor={'population'}
                        backgroundColor={'transparent'}
                        paddingLeft={'0'}
                        center={[(Dimensions.get('window').width - 64) / 4 - 16, 0]}
                        hasLegend={false}
                        absolute
                      />
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                      {pieData.map(d => (
                        <View key={d.name} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: d.color, marginRight: 6 }} />
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.textSecondary }}>
                            {d.name} <Text style={{ fontFamily: 'SpaceMono', color: colors.textPrimary, fontWeight: 'bold' }}>{d.population}</Text>
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <Text style={[styles.noDataText, { color: colors.textDim }]}>No data yet</Text>
                )}
              </View>

              <View style={[styles.analyticsCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Highest Risk Rooms</Text>
                {topOffenders.length > 0 ? topOffenders.map((item, i) => (
                  <View key={item.room} style={styles.offenderRow}>
                    <Text style={[styles.offenderRank, { color: colors.textDim }]}>{i + 1}.</Text>
                    <Text style={[styles.offenderRoom, { color: colors.accent }]}>{shortRoom(item.room)}</Text>
                    <View style={[styles.offenderTrack, { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: colors.border }]}>
                      <View style={[styles.offenderFill, { width: `${item.score}%`, backgroundColor: riskColor(item.score) }]} />
                    </View>
                    <Text style={[styles.offenderScore, { color: riskColor(item.score) }]}>{item.score}</Text>
                  </View>
                )) : (
                  <Text style={[styles.noDataText, { color: colors.textDim }]}>No data yet</Text>
                )}
              </View>

              <View style={styles.controlsRow}>
                <View style={styles.filterGroup}>
                  {(['all', 'high', 'medium', 'low'] as const).map(f => (
                    <TouchableOpacity
                      key={f}
                      onPress={() => setFilter(f)}
                      style={[
                        styles.filterBtn,
                        { borderColor: colors.border },
                        filter === f ? {
                          backgroundColor: f === 'high' ? colors.red : f === 'medium' ? colors.amber : f === 'low' ? colors.emerald : colors.accent,
                          borderColor: f === 'high' ? colors.red : f === 'medium' ? colors.amber : f === 'low' ? colors.emerald : colors.accent,
                        } : { backgroundColor: colors.surface }
                      ]}
                    >
                      <Text style={[
                        styles.filterBtnText,
                        { color: filter === f ? '#000' : colors.textSecondary }
                      ]}>{f.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity onPress={exportCsv} disabled={filtered.length === 0} style={[styles.exportBtn, { borderColor: colors.border, backgroundColor: colors.surface }, filtered.length === 0 && { opacity: 0.4 }]}>
                  <Download size={14} color={colors.textPrimary} />
                  <Text style={[styles.exportBtnText, { color: colors.textPrimary }]}>CSV</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Search size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
                <TextInput
                  style={[styles.searchInput, { color: colors.textPrimary }]}
                  placeholder="Search alerts…"
                  placeholderTextColor={colors.textDim}
                  value={search}
                  onChangeText={setSearch}
                />
              </View>
            </View>
          }
        />
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={!!selectedAlert}
        onRequestClose={() => setSelectedAlert(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {selectedAlert && (
              <>
                <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                    <View style={[styles.modalIconBox, { backgroundColor: isDark ? 'rgba(240,165,0,0.1)' : 'rgba(240,165,0,0.05)', borderColor: isDark ? 'rgba(240,165,0,0.3)' : 'rgba(240,165,0,0.1)' }]}>
                      <ShieldAlert size={20} color={colors.amber} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Alert Deep Dive</Text>
                      <Text style={[styles.modalSubtitle, { color: colors.textDim }]}>{formatTime(selectedAlert.time)} • Room: {selectedAlert.roomId}</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedAlert(null)} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
                    <X size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.modalBody}>
                  <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                    <View style={[styles.infoBox, { flex: 1, backgroundColor: 'rgba(255,255,255,0.02)', borderColor: colors.border }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>VIOLATION TYPE</Text>
                      <Text style={[styles.infoText, { color: colors.textPrimary }]}>{friendlyType(selectedAlert.eventType)}</Text>
                    </View>
                    <View style={[styles.infoBox, { flex: 1, backgroundColor: 'rgba(255,255,255,0.02)', borderColor: colors.border }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>RISK DELTA / TOTAL</Text>
                      <Text style={[styles.infoText, { color: colors.red }]}>
                        +{selectedAlert.penalty} <Text style={{ color: riskColor(selectedAlert.totalRisk) }}>/ {selectedAlert.totalRisk}</Text>
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.infoBox, { backgroundColor: 'rgba(255,255,255,0.02)', borderColor: colors.border, marginBottom: 16 }]}>
                    <Text style={[styles.metricLabel, { color: colors.textDim }]}>MESSAGE LOG</Text>
                    <Text style={[styles.infoText, { color: colors.textSecondary }]}>{selectedAlert.message || '—'}</Text>
                  </View>

                  <View style={[styles.infoBox, { backgroundColor: 'rgba(255,255,255,0.02)', borderColor: colors.border, height: 160, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', position: 'relative' }]}>
                    <Text style={[styles.metricLabel, { color: colors.textDim, zIndex: 10, position: 'absolute', top: 12, left: 12 }]}>EVIDENCE</Text>
                    {selectedAlert.evidenceUrl && !imageError ? (
                      <TouchableOpacity activeOpacity={0.85} onPress={() => setViewerUri(evidenceUri(selectedAlert.evidenceUrl))} style={{ position: 'absolute', width: '100%', height: '100%' }}>
                        <Image
                          source={{ uri: evidenceUri(selectedAlert.evidenceUrl)! }}
                          style={{ width: '100%', height: '100%' }}
                          resizeMode="cover"
                          onError={() => setImageError(true)}
                        />
                        <Text style={[styles.metricLabel, { position: 'absolute', bottom: 8, right: 12, color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 6, borderRadius: 4 }]}>TAP TO ENLARGE</Text>
                      </TouchableOpacity>
                    ) : selectedAlert.evidenceUrl ? (
                      // Never substitute a stock image for evidence
                      <View style={{ alignItems: 'center', gap: 6 }}>
                        <ImageOff size={32} color={colors.textDim} />
                        <Text style={[styles.metricLabel, { color: colors.textDim }]}>Evidence link expired - pull to refresh</Text>
                      </View>
                    ) : (
                      <View style={{ alignItems: 'center', gap: 6 }}>
                        <ImageOff size={32} color={colors.textDim} />
                        <Text style={[styles.metricLabel, { color: colors.textDim }]}>No screenshot was captured for this alert</Text>
                      </View>
                    )}
                  </View>

                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                    <TouchableOpacity disabled={!roomActionsEnabled} onPress={() => openWarn(selectedAlert.roomId)} style={[styles.actionBtnSecondary, { backgroundColor: isDark ? 'rgba(240,165,0,0.1)' : 'rgba(240,165,0,0.05)', borderColor: isDark ? 'rgba(240,165,0,0.3)' : 'rgba(240,165,0,0.15)' }, !roomActionsEnabled && styles.disabled]}>
                      <AlertTriangle size={16} color={colors.amber} style={{ marginBottom: 4 }} />
                      <Text style={[styles.actionBtnSecondaryText, { color: colors.amber }]}>Warn User</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={!roomActionsEnabled} onPress={() => handleKillSession(selectedAlert.roomId)} style={[styles.actionBtnSecondary, { backgroundColor: isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)', borderColor: isDark ? 'rgba(255,59,92,0.3)' : 'rgba(255,59,92,0.15)' }, !roomActionsEnabled && styles.disabled]}>
                      <X size={16} color={colors.red} style={{ marginBottom: 4 }} />
                      <Text style={[styles.actionBtnSecondaryText, { color: colors.red }]}>Kill Session</Text>
                    </TouchableOpacity>
                  </View>
                  {roomActionsHint ? (
                    <Text style={[styles.hintText, { color: colors.textDim }]}>{roomActionsHint}</Text>
                  ) : null}
                </View>

                <View style={[styles.modalActions, { borderTopColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}>
                  <TouchableOpacity disabled={selectedAlert.liveOnly} onPress={() => updateAlertStatus(selectedAlert, { falsePositive: !selectedAlert.falsePositive })} style={[styles.actionBtnPrimary, { borderColor: colors.border, backgroundColor: selectedAlert.falsePositive ? colors.emerald : 'transparent' }, selectedAlert.liveOnly && styles.disabled]}>
                    <CheckCircle size={16} color={selectedAlert.falsePositive ? '#000' : colors.textSecondary} style={{ marginRight: 8 }} />
                    <Text style={[styles.actionBtnPrimaryText, { color: selectedAlert.falsePositive ? '#000' : colors.textSecondary }]}>{selectedAlert.falsePositive ? 'Marked as FP' : 'Mark False Positive'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={selectedAlert.liveOnly} onPress={() => updateAlertStatus(selectedAlert, { flagged: !selectedAlert.flagged })} style={[styles.actionBtnPrimary, { borderColor: colors.border, backgroundColor: selectedAlert.flagged ? colors.amber : 'transparent' }, selectedAlert.liveOnly && styles.disabled]}>
                    <Flag size={16} color={selectedAlert.flagged ? '#000' : colors.textSecondary} style={{ marginRight: 8 }} />
                    <Text style={[styles.actionBtnPrimaryText, { color: selectedAlert.flagged ? '#000' : colors.textSecondary }]}>{selectedAlert.flagged ? 'Flagged for Review' : 'Flag for Review'}</Text>
                  </TouchableOpacity>
                </View>
                {selectedAlert.liveOnly ? (
                  <Text style={[styles.hintText, { color: colors.textDim, paddingHorizontal: 16, paddingBottom: 16 }]}>
                    This alert arrived live but was not stored by the server (for example while the database was offline), so it cannot be flagged or marked as a false positive.
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!viewerUri} animationType="fade" transparent={true} onRequestClose={() => setViewerUri(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' }}>
          {viewerUri && <Image source={{ uri: viewerUri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}
          <TouchableOpacity onPress={() => setViewerUri(null)} style={{ position: 'absolute', top: Platform.OS === 'ios' ? 60 : 30, right: 20, padding: 10 }}>
            <X size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={!!warnRoomId} animationType="slide" transparent={true} onRequestClose={() => setWarnRoomId(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}>
              <View>
                <Text style={{ color: colors.amber, fontSize: 16, fontFamily: 'Inter_700Bold' }}>Send Warning</Text>
                <Text style={[styles.modalSubtitle, { color: colors.textDim }]}>Room {warnRoomId}</Text>
              </View>
              <TouchableOpacity onPress={() => setWarnRoomId(null)} style={[styles.closeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                <X size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={[styles.metricLabel, { color: colors.textDim }]}>MESSAGE TO EVERYONE IN THE ROOM</Text>
              <TextInput
                value={warnMessage}
                onChangeText={setWarnMessage}
                placeholder="Type your warning message here..."
                placeholderTextColor={colors.textDim}
                multiline
                maxLength={500}
                autoFocus
                style={{
                  backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.5)',
                  color: colors.textPrimary,
                  borderRadius: 8,
                  padding: 12,
                  height: 100,
                  textAlignVertical: 'top',
                  borderColor: colors.border,
                  borderWidth: 1,
                  fontFamily: 'SpaceMono'
                }}
              />
              {!connected ? (
                <Text style={[styles.hintText, { color: colors.red }]}>Not connected to the server.</Text>
              ) : null}
            </View>
            <View style={[styles.modalActions, { borderTopColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}>
              <TouchableOpacity onPress={() => setWarnRoomId(null)} style={[styles.actionBtnSecondary, { borderColor: colors.border }]}>
                <Text style={[styles.actionBtnSecondaryText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={!connected} onPress={submitWarning} style={[styles.actionBtnSecondary, { borderColor: colors.amber, backgroundColor: isDark ? 'rgba(251, 191, 36, 0.1)' : 'rgba(251, 191, 36, 0.2)' }, !connected && styles.disabled]}>
                <Text style={[styles.actionBtnSecondaryText, { color: colors.amber }]}>Send Warning</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  baseBg: { ...StyleSheet.absoluteFill },
  gridBg: { ...StyleSheet.absoluteFill },
  headerContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 40, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)', zIndex: 20 },
  iconBtn: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  headerStats: { fontSize: 11, fontFamily: 'SpaceMono', marginTop: 2 },
  listContainer: { paddingBottom: 100 },

  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1 },
  noticeText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  bannerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium' },

  analyticsCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16, overflow: 'hidden' },
  cardTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 12 },
  noDataText: { fontSize: 12, fontFamily: 'SpaceMono', textAlign: 'center', padding: 20 },

  offenderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 },
  offenderRank: { width: 20, fontSize: 12, fontFamily: 'SpaceMono' },
  offenderRoom: { flex: 1, fontSize: 12, fontFamily: 'SpaceMono', fontWeight: 'bold' },
  offenderTrack: { flex: 2, height: 8, borderRadius: 4, borderWidth: 1, overflow: 'hidden' },
  offenderFill: { height: '100%', borderRadius: 4 },
  offenderScore: { width: 30, fontSize: 12, fontFamily: 'SpaceMono', fontWeight: 'bold', textAlign: 'right' },

  controlsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  filterGroup: { flexDirection: 'row', gap: 6 },
  filterBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  filterBtnText: { fontSize: 10, fontFamily: 'SpaceMono', fontWeight: 'bold' },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  exportBtnText: { fontSize: 10, fontFamily: 'SpaceMono', fontWeight: 'bold' },

  searchBox: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  searchInput: { flex: 1, height: 24, fontSize: 14, fontFamily: 'SpaceMono' },

  card: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, marginHorizontal: 16 },
  cardInner: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  statusIndicator: { width: 10, height: 10, borderRadius: 5, marginRight: 16, shadowOpacity: 0.8, shadowRadius: 8 },
  alertInfo: { flex: 1 },
  alertType: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  alertDetail: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 6 },
  alertTime: { fontSize: 10, fontFamily: 'SpaceMono' },
  metrics: { alignItems: 'flex-end', gap: 6 },
  penaltyText: { fontSize: 14, fontFamily: 'SpaceMono', fontWeight: 'bold' },
  riskBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  riskText: { fontSize: 9, fontFamily: 'SpaceMono', fontWeight: 'bold' },

  emptyContainer: { padding: 40, alignItems: 'center', marginTop: 10 },
  emptyIconBox: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1 },
  emptyText: { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  emptySubtext: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.7)', padding: 16 },
  modalContent: { width: '100%', borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  modalIconBox: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  modalSubtitle: { fontSize: 11, fontFamily: 'SpaceMono', marginTop: 2 },
  closeBtn: { padding: 8, borderRadius: 8 },
  modalBody: { padding: 20 },
  infoBox: { padding: 12, borderRadius: 8, borderWidth: 1 },
  metricLabel: { fontSize: 10, fontFamily: 'SpaceMono', letterSpacing: 1, marginBottom: 4 },
  infoText: { fontSize: 13, fontFamily: 'SpaceMono' },
  hintText: { fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 8, textAlign: 'center' },
  disabled: { opacity: 0.4 },

  modalActions: { flexDirection: 'row', padding: 16, borderTopWidth: 1, gap: 12 },
  actionBtnPrimary: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actionBtnPrimaryText: { fontSize: 11, fontFamily: 'SpaceMono', fontWeight: 'bold' },
  actionBtnSecondary: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actionBtnSecondaryText: { fontSize: 11, fontFamily: 'SpaceMono', fontWeight: 'bold' },

  glowAccent: { shadowColor: '#00d4ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 5 },
});
