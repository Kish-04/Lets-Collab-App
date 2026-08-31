import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, ImageBackground, TouchableOpacity, Modal, Platform, TextInput, ScrollView, Dimensions, Alert, Image } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { BACKEND_URL, getAuthHeaders } from '../../lib/api';
import { ShieldAlert, X, Sun, Moon, Search, Download, Flag, CheckCircle, AlertTriangle } from 'lucide-react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { PieChart } from 'react-native-chart-kit';

export default function AlertsScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [imageError, setImageError] = useState(false);
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${BACKEND_URL}/api/admin/reports`, { headers });
        const data = await res.json();
        if (data.alerts) {
          // Add some derived fields for mobile matching the web API shape
          const processed = data.alerts.map((a: any) => {
            const room = a.room || a.roomId || 'SYSTEM';
            const penalty = a.penalty || 0;
            return {
              ...a,
              roomId: room,
              penalty,
              totalRisk: Math.min(100, (a.totalRisk || penalty)),
              flagged: Boolean(a.flagged),
              falsePositive: Boolean(a.falsePositive),
            };
          });
          setAlerts(processed);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAlerts();
  }, []);

  const friendlyType = (raw: string) => {
    const map: Record<string, string> = {
      NO_FACE: "No face detected",
      MULTIPLE_FACES: "Multiple faces",
      LOOKING_AWAY: "Looking away",
      PHONE_DETECTED: "Phone detected",
      BLURR_EVENT: "Alt+Tab / blur",
      CLIPBOARD_CHANGE: "Clipboard change",
      os_anticheat_violation: "OS event",
      anticheat_violation: "AI detection",
    };
    return map[raw] || raw;
  };

  const isDark = theme === 'dark' || theme === 'glassmorphic';

  const updateAlertStatus = async (id: string, updates: any) => {
    setAlerts(prev => prev.map(a => a._id === id ? { ...a, ...updates } : a));
    if (selectedAlert?._id === id) {
      setSelectedAlert((prev: any) => prev ? { ...prev, ...updates } : null);
    }
    try {
      const headers = await getAuthHeaders();
      await fetch(`${BACKEND_URL}/api/admin/alerts/${id}/status`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch (err) {
      console.error('Failed to update alert status', err);
    }
  };

  const [warnModalVisible, setWarnModalVisible] = useState(false);
  const [warnRoomId, setWarnRoomId] = useState<string | null>(null);
  const [warnMessage, setWarnMessage] = useState("");

  const handleWarnUser = (roomId: string) => {
    setWarnRoomId(roomId);
    setWarnMessage("");
    setWarnModalVisible(true);
  };

  const submitWarning = async () => {
    if (!warnRoomId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND_URL}/api/admin/rooms/${warnRoomId}/warn`, { 
        method: 'POST', 
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: warnMessage || "Admin has issued a warning." })
      });
      if (res.ok) {
        Alert.alert("Warn User", `Warning sent successfully to room ${warnRoomId}`);
        setWarnModalVisible(false);
      } else {
        Alert.alert("Error", `Failed to send warning`);
      }
    } catch (err) {
      console.error(err);
      Alert.alert("Error", `Network error sending warning`);
    }
  };

  const handleKillSession = async (roomId: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND_URL}/api/admin/rooms/${roomId}/kill`, { method: 'POST', headers });
      if (res.ok) {
        Alert.alert("Kill Session", `Session terminated for room ${roomId}`);
        setSelectedAlert(null);
      } else {
        Alert.alert("Error", `Failed to terminate session`);
      }
    } catch (err) {
      console.error(err);
      Alert.alert("Error", `Network error terminating session`);
    }
  };

  const filtered = alerts.filter(a => {
    const matchSearch =
      (a.roomId || '').toLowerCase().includes(search.toLowerCase()) ||
      friendlyType(a.event || a.type || '').toLowerCase().includes(search.toLowerCase()) ||
      (a.message || '').toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    
    const risk = a.totalRisk || 0;
    if (filter === "high") return risk >= 70;
    if (filter === "medium") return risk >= 30 && risk < 70;
    if (filter === "low") return risk < 30;
    return true;
  });

  const typeCounts = alerts.reduce<Record<string, number>>((acc, a) => {
    const type = friendlyType(a.event || a.type || 'Unknown');
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  
  const pieColors = [colors.amber, colors.violet, colors.accent, colors.emerald, colors.red];
  const pieData = Object.entries(typeCounts).map(([name, value], i) => ({
    name,
    population: value,
    color: pieColors[i % pieColors.length],
    legendFontColor: colors.textSecondary,
    legendFontSize: 12
  }));

  const roomRiskTotals = new Map<string, number>();
  alerts.forEach(a => {
    const prev = roomRiskTotals.get(a.roomId) || 0;
    roomRiskTotals.set(a.roomId, Math.min(100, prev + (a.penalty || 0)));
  });
  const topOffenders = Array.from(roomRiskTotals.entries())
    .map(([room, score]) => ({ room, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const renderItem = ({ item, index }: { item: any, index: number }) => {
    const isCritical = item.totalRisk >= 70;
    const isMedium = item.totalRisk >= 30 && item.totalRisk < 70;
    
    return (
      <AnimatedPressable hapticFeedback="light" onPress={() => { setImageError(false); setSelectedAlert(item); }} style={{ marginBottom: 12 }}>
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }, isCritical && { borderColor: isDark ? 'rgba(255, 59, 92, 0.4)' : 'rgba(255, 59, 92, 0.3)' }, item.falsePositive && { opacity: 0.6 }]}>
            <View style={styles.cardInner}>
              <View style={[styles.statusIndicator, { backgroundColor: isCritical ? colors.red : isMedium ? colors.amber : colors.emerald, shadowColor: isCritical ? colors.red : isMedium ? colors.amber : colors.emerald }]} />
              
              <View style={styles.alertInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {item.flagged && <Flag size={12} color={colors.amber} />}
                  {item.falsePositive && <CheckCircle size={12} color={colors.emerald} />}
                  <Text style={[styles.alertType, { color: colors.textPrimary }]}>{friendlyType(item.event || item.type)}</Text>
                </View>
                <Text style={[styles.alertDetail, { color: colors.textDim }]} numberOfLines={1}>{item.message}</Text>
                <Text style={[styles.alertTime, { color: colors.textDim }]}>{new Date(item.time || item.timestamp).toLocaleString()}</Text>
              </View>
              
              <View style={styles.metrics}>
                <Text style={[styles.penaltyText, { color: colors.red }]}>+{item.penalty}</Text>
                <View style={[styles.riskBadge, { backgroundColor: isCritical ? (isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)') : isMedium ? (isDark ? 'rgba(240,165,0,0.1)' : 'rgba(240,165,0,0.05)') : (isDark ? 'rgba(0,196,140,0.1)' : 'rgba(0,196,140,0.05)'), borderColor: isCritical ? (isDark ? 'rgba(255,59,92,0.3)' : 'rgba(255,59,92,0.15)') : isMedium ? (isDark ? 'rgba(240,165,0,0.3)' : 'rgba(240,165,0,0.15)') : (isDark ? 'rgba(0,196,140,0.3)' : 'rgba(0,196,140,0.15)') }]}>
                  <Text style={[styles.riskText, { color: isCritical ? colors.red : isMedium ? colors.amber : colors.emerald }]}>
                    RISK {item.totalRisk}
                  </Text>
                </View>
              </View>
            </View>
          </View>
      </AnimatedPressable>
    );
  };

  const ListEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconBox, { backgroundColor: isDark ? 'rgba(0, 196, 140, 0.1)' : 'rgba(0, 196, 140, 0.05)', borderColor: isDark ? 'rgba(0, 196, 140, 0.3)' : 'rgba(0, 196, 140, 0.1)' }]}>
        <ShieldAlert size={48} color={colors.accent} style={isDark && styles.glowAccent} />
      </View>
      <Text style={[styles.emptyText, { color: colors.textPrimary }]}>All systems secure</Text>
      <Text style={[styles.emptySubtext, { color: colors.textDim }]}>No active alerts match your criteria.</Text>
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
      
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Security Alerts</Text>
        <TouchableOpacity onPress={toggleTheme} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {isDark ? <Sun size={16} color={colors.textSecondary} /> : <Moon size={16} color={colors.textSecondary} />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item: any, index) => item._id || index.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={ListEmpty}
          ListHeaderComponent={
            <View style={styles.headerContent}>
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
                        accessor={"population"}
                        backgroundColor={"transparent"}
                        paddingLeft={"0"}
                        center={[(Dimensions.get('window').width - 64) / 4 - 16, 0]}
                        hasLegend={false}
                        absolute
                      />
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                      {pieData.sort((a,b) => b.population - a.population).map((d, i) => (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: d.color, marginRight: 6 }} />
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.textSecondary }}>
                            {d.name} <Text style={{ fontFamily: 'SpaceMono', color: colors.textPrimary, fontWeight: 'bold' }}>{d.population}</Text>
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <Text style={[styles.noDataText, { color: colors.textDim }]}>No data available</Text>
                )}
              </View>

              <View style={[styles.analyticsCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Highest Risk Rooms</Text>
                {topOffenders.length > 0 ? topOffenders.map((item, i) => (
                  <View key={item.room} style={styles.offenderRow}>
                    <Text style={[styles.offenderRank, { color: colors.textDim }]}>{i + 1}.</Text>
                    <Text style={[styles.offenderRoom, { color: colors.accent }]}>{item.room.length >= 8 ? `${item.room.slice(0, 4)}·${item.room.slice(4, 8)}` : item.room}</Text>
                    <View style={[styles.offenderTrack, { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: colors.border }]}>
                      <View style={[styles.offenderFill, { width: `${item.score}%`, backgroundColor: item.score >= 70 ? colors.red : item.score >= 30 ? colors.amber : colors.emerald }]} />
                    </View>
                    <Text style={[styles.offenderScore, { color: item.score >= 70 ? colors.red : item.score >= 30 ? colors.amber : colors.emerald }]}>{item.score}</Text>
                  </View>
                )) : (
                  <Text style={[styles.noDataText, { color: colors.textDim }]}>No data available</Text>
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
                <TouchableOpacity onPress={() => Alert.alert('Export', 'CSV Exported')} style={[styles.exportBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.modalIconBox, { backgroundColor: isDark ? 'rgba(240,165,0,0.1)' : 'rgba(240,165,0,0.05)', borderColor: isDark ? 'rgba(240,165,0,0.3)' : 'rgba(240,165,0,0.1)' }]}>
                      <ShieldAlert size={20} color={colors.amber} />
                    </View>
                    <View>
                      <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Alert Deep Dive</Text>
                      <Text style={[styles.modalSubtitle, { color: colors.textDim }]}>{new Date(selectedAlert.time || selectedAlert.timestamp).toLocaleString()} • Room: {selectedAlert.roomId}</Text>
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
                      <Text style={[styles.infoText, { color: colors.textPrimary }]}>{friendlyType(selectedAlert.event || selectedAlert.type)}</Text>
                    </View>
                    <View style={[styles.infoBox, { flex: 1, backgroundColor: 'rgba(255,255,255,0.02)', borderColor: colors.border }]}>
                      <Text style={[styles.metricLabel, { color: colors.textDim }]}>RISK DELTA</Text>
                      <Text style={[styles.infoText, { color: colors.red }]}>+{selectedAlert.penalty}</Text>
                    </View>
                  </View>
                  <View style={[styles.infoBox, { backgroundColor: 'rgba(255,255,255,0.02)', borderColor: colors.border, marginBottom: 16 }]}>
                    <Text style={[styles.metricLabel, { color: colors.textDim }]}>MESSAGE LOG</Text>
                    <Text style={[styles.infoText, { color: colors.textSecondary }]}>{selectedAlert.message}</Text>
                  </View>

                  <View style={[styles.infoBox, { backgroundColor: 'rgba(255,255,255,0.02)', borderColor: colors.border, marginBottom: 16, height: 160, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', position: 'relative' }]}>
                    <Text style={[styles.metricLabel, { color: colors.textDim, zIndex: 10, position: 'absolute', top: 12, left: 12 }]}>AI EVIDENCE</Text>
                    {selectedAlert.evidenceUrl ? (
                      <Image 
                        source={{ uri: imageError ? 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=500&q=80' : (selectedAlert.evidenceUrl.startsWith('http') ? selectedAlert.evidenceUrl : `${BACKEND_URL}${selectedAlert.evidenceUrl}`) }} 
                        style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.6 }} 
                        resizeMode="cover"
                        onError={() => setImageError(true)}
                      />
                    ) : (
                      <ShieldAlert size={40} color={colors.red} />
                    )}
                  </View>

                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                    <TouchableOpacity onPress={() => handleWarnUser(selectedAlert.roomId)} style={[styles.actionBtnSecondary, { backgroundColor: isDark ? 'rgba(240,165,0,0.1)' : 'rgba(240,165,0,0.05)', borderColor: isDark ? 'rgba(240,165,0,0.3)' : 'rgba(240,165,0,0.15)' }]}>
                      <AlertTriangle size={16} color={colors.amber} style={{ marginBottom: 4 }} />
                      <Text style={[styles.actionBtnSecondaryText, { color: colors.amber }]}>Warn User</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleKillSession(selectedAlert.roomId)} style={[styles.actionBtnSecondary, { backgroundColor: isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)', borderColor: isDark ? 'rgba(255,59,92,0.3)' : 'rgba(255,59,92,0.15)' }]}>
                      <X size={16} color={colors.red} style={{ marginBottom: 4 }} />
                      <Text style={[styles.actionBtnSecondaryText, { color: colors.red }]}>Kill Session</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                
                <View style={[styles.modalActions, { borderTopColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}>
                  <TouchableOpacity onPress={() => updateAlertStatus(selectedAlert._id, { falsePositive: !selectedAlert.falsePositive })} style={[styles.actionBtnPrimary, { borderColor: colors.border, backgroundColor: selectedAlert.falsePositive ? colors.emerald : 'transparent' }]}>
                    <CheckCircle size={16} color={selectedAlert.falsePositive ? '#000' : colors.textSecondary} style={{ marginRight: 8 }} />
                    <Text style={[styles.actionBtnPrimaryText, { color: selectedAlert.falsePositive ? '#000' : colors.textSecondary }]}>{selectedAlert.falsePositive ? "Marked as FP" : "Mark False Positive"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => updateAlertStatus(selectedAlert._id, { flagged: !selectedAlert.flagged })} style={[styles.actionBtnPrimary, { borderColor: colors.border, backgroundColor: selectedAlert.flagged ? colors.amber : 'transparent' }]}>
                    <Flag size={16} color={selectedAlert.flagged ? '#000' : colors.textSecondary} style={{ marginRight: 8 }} />
                    <Text style={[styles.actionBtnPrimaryText, { color: selectedAlert.flagged ? '#000' : colors.textSecondary }]}>{selectedAlert.flagged ? "Flagged for Review" : "Flag for Review"}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={warnModalVisible} animationType="slide" transparent={true} onRequestClose={() => setWarnModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.modalHeader, { borderColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}>
              <Text style={{ color: colors.amber, fontSize: 16, fontFamily: 'Inter_700Bold' }}>Send Warning</Text>
              <TouchableOpacity onPress={() => setWarnModalVisible(false)} style={[styles.closeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                <X size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={[styles.metricLabel, { color: colors.textDim }]}>MESSAGE TO HOST/CONTROLLER</Text>
              <TextInput
                value={warnMessage}
                onChangeText={setWarnMessage}
                placeholder="Type your warning message here..."
                placeholderTextColor={colors.textDim}
                multiline
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
            </View>
            <View style={[styles.modalActions, { borderTopColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}>
              <TouchableOpacity onPress={() => setWarnModalVisible(false)} style={[styles.actionBtnSecondary, { borderColor: colors.border }]}>
                <Text style={[styles.actionBtnSecondaryText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitWarning} style={[styles.actionBtnSecondary, { borderColor: colors.amber, backgroundColor: isDark ? 'rgba(251, 191, 36, 0.1)' : 'rgba(251, 191, 36, 0.2)' }]}>
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
  listContainer: { paddingBottom: 100 },
  
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
  
  modalActions: { flexDirection: 'row', padding: 16, borderTopWidth: 1, gap: 12 },
  actionBtnPrimary: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actionBtnPrimaryText: { fontSize: 11, fontFamily: 'SpaceMono', fontWeight: 'bold' },
  actionBtnSecondary: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actionBtnSecondaryText: { fontSize: 11, fontFamily: 'SpaceMono', fontWeight: 'bold' },
  
  glowAccent: { shadowColor: '#00d4ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 5 },
});
