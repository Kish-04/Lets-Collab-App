import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, ImageBackground, TouchableOpacity, Platform, Alert, Dimensions } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { BACKEND_URL, getAuthHeaders } from '../../lib/api';
import { ChevronDown, ChevronUp, Download, FileText, Code, Network, Sun, Moon, Users, Shield, RefreshCw } from 'lucide-react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';

const { width } = Dimensions.get('window');

const DataCard = ({ label, value, color, icon: Icon, isDark }: any) => (
  <View style={[styles.dataCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : '#fff', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <Text style={[styles.dataCardLabel, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }]}>{label}</Text>
      <View style={[styles.dataCardIconBox, { backgroundColor: color + '20' }]}>
        <Icon size={14} color={color} />
      </View>
    </View>
    <Text style={[styles.dataCardValue, { color }]}>{value}</Text>
  </View>
);

export default function ReportsScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [openUsers, setOpenUsers] = useState(false);
  const [openAlerts, setOpenAlerts] = useState(false);
  const [openFull, setOpenFull] = useState(false);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND_URL}/api/admin/reports`, { headers });
      const json = await res.json();
      if (json.success) setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const handleExport = async (format: string) => {
    try {
      let fileUri = '';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      if (format === 'PDF') {
        const html = `
          <html>
            <head>
              <style>
                body { font-family: sans-serif; padding: 20px; }
                h1 { color: #333; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
              </style>
            </head>
            <body>
              <h1>System Report</h1>
              <p>Generated: ${new Date().toLocaleString()}</p>
              <h2>Security Alerts</h2>
              <table>
                <tr><th>Time</th><th>User</th><th>Type</th><th>Risk</th></tr>
                ${data.alerts.map((a: any) => `<tr><td>${a.time}</td><td>${a.hostEmail}</td><td>${a.type}</td><td>${a.penalty}</td></tr>`).join('')}
              </table>
            </body>
          </html>
        `;
        const { uri } = await Print.printToFileAsync({ html });
        fileUri = uri;
      } else if (format === 'JSON') {
        const jsonString = JSON.stringify(data, null, 2);
        fileUri = `${FileSystem.documentDirectory}report_${timestamp}.json`;
        await FileSystem.writeAsStringAsync(fileUri, jsonString, { encoding: FileSystem.EncodingType.UTF8 });
      } else if (format === 'CSV') {
        let csvString = 'Time,User,Type,Penalty\n';
        data.alerts.forEach((a: any) => {
          csvString += `"${a.time}","${a.hostEmail}","${a.type}","${a.penalty}"\n`;
        });
        fileUri = `${FileSystem.documentDirectory}report_${timestamp}.csv`;
        await FileSystem.writeAsStringAsync(fileUri, csvString, { encoding: FileSystem.EncodingType.UTF8 });
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert("Export Successful", `${format} file saved.`);
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Export Failed", "Could not generate file.");
    }
  };

  const isDark = theme === 'dark' || theme === 'glassmorphic';

  const userActivity = data?.userActivity || [];
  const alertsData = data?.alerts || [];
  const totalSessions = userActivity.reduce((acc: number, u: any) => acc + (u.sessionCount || 0), 0);
  const totalPenalty = alertsData.reduce((acc: number, a: any) => acc + (a.penalty || 0), 0);
  
  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleString();
    } catch { return d; }
  };

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
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>System Reports</Text>
          {data?.generatedAt && (
            <Text style={[styles.headerSubtitle, { color: colors.textDim }]}>Last generated: {formatDate(data.generatedAt)}</Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity onPress={fetchReports} style={[styles.iconBtn, { borderColor: colors.accent, backgroundColor: colors.accent + '20' }]}>
            <RefreshCw size={16} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleTheme} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {isDark ? <Sun size={16} color={colors.textSecondary} /> : <Moon size={16} color={colors.textSecondary} />}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.listContainer}>
        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 50 }} />
        ) : !data ? (
          <View style={[styles.errorContainer, { backgroundColor: isDark ? 'rgba(255, 59, 92, 0.1)' : 'rgba(255, 59, 92, 0.05)', borderColor: isDark ? 'rgba(255, 59, 92, 0.3)' : 'rgba(255, 59, 92, 0.2)' }]}>
            <Text style={[styles.errorText, { color: colors.red }]}>Failed to load reports. Is the server running?</Text>
          </View>
        ) : (
          <>
            <View style={styles.dataCardsGrid}>
              <DataCard label="Total Users" value={userActivity.length} color={colors.textPrimary} icon={Users} isDark={isDark} />
              <DataCard label="Total Sessions" value={totalSessions} color={colors.accent} icon={ActivityIndicator} isDark={isDark} />
              <DataCard label="Total Alerts" value={alertsData.length} color={colors.amber} icon={Shield} isDark={isDark} />
              <DataCard label="Total Penalty" value={totalPenalty} color={colors.red} icon={Network} isDark={isDark} />
            </View>

            {/* USER ACTIVITY SUMMARY */}
            <Animated.View layout={LinearTransition.springify()}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardHeaderTop}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={[styles.iconBox, { backgroundColor: 'rgba(0, 212, 255, 0.1)', borderColor: 'rgba(0, 212, 255, 0.2)' }]}>
                      <Users size={20} color={colors.accent} />
                    </View>
                    <View>
                      <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>User Activity Summary</Text>
                      <Text style={[styles.cardSubtitle, { color: colors.textDim }]}>Sessions per user, roles, verification status</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={styles.exportRowMini}>
                      <TouchableOpacity onPress={() => handleExport('JSON')}><Text style={[styles.exportMiniText, { color: colors.accent }]}>JSON</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => handleExport('CSV')}><Text style={[styles.exportMiniText, { color: colors.emerald }]}>CSV</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => handleExport('PDF')}><Text style={[styles.exportMiniText, { color: colors.amber }]}>PDF</Text></TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => setOpenUsers(!openUsers)} style={[styles.previewToggleBtn, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                      <Text style={[styles.previewToggleText, { color: colors.textSecondary }]}>{openUsers ? '▲ Hide preview' : '▼ Preview data'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {openUsers && (
                  <View style={[styles.expandedPreview, { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)' }]}>
                    <ScrollView nestedScrollEnabled>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View>
                        <View style={[styles.tableRow, { borderBottomColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                          <Text style={[styles.th, { color: colors.textDim, width: 120 }]}>NAME</Text>
                          <Text style={[styles.th, { color: colors.textDim, width: 160 }]}>EMAIL</Text>
                          <Text style={[styles.th, { color: colors.textDim, width: 80 }]}>ROLE</Text>
                          <Text style={[styles.th, { color: colors.textDim, width: 80 }]}>SESSIONS</Text>
                          <Text style={[styles.th, { color: colors.textDim, width: 100 }]}>STATUS</Text>
                        </View>
                        {userActivity.slice(0, 10).map((u: any, i: number) => (
                          <View key={i} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
                            <Text style={[styles.td, { color: colors.textPrimary, width: 120 }]} numberOfLines={1}>{u.name}</Text>
                            <Text style={[styles.td, { color: colors.textDim, width: 160 }]} numberOfLines={1}>{u.email}</Text>
                            <View style={{ width: 80, justifyContent: 'center' }}>
                              <Text style={[styles.roleBadge, { color: u.role === 'admin' ? colors.violet : colors.textDim, backgroundColor: u.role === 'admin' ? colors.violet + '20' : 'transparent', borderColor: u.role === 'admin' ? colors.violet + '40' : colors.border }]}>{u.role.toUpperCase()}</Text>
                            </View>
                            <Text style={[styles.td, { color: colors.accent, width: 80, fontWeight: 'bold' }]}>{u.sessionCount}</Text>
                            <View style={{ width: 100, justifyContent: 'center' }}>
                              <Text style={[styles.roleBadge, { color: u.banned ? colors.red : u.isVerified ? colors.emerald : colors.amber, backgroundColor: (u.banned ? colors.red : u.isVerified ? colors.emerald : colors.amber) + '20', borderColor: (u.banned ? colors.red : u.isVerified ? colors.emerald : colors.amber) + '40' }]}>{u.banned ? 'BLOCKED' : u.isVerified ? 'ACTIVE' : 'UNVERIFIED'}</Text>
                            </View>
                          </View>
                        ))}
                        </View>
                      </ScrollView>
                    </ScrollView>
                  </View>
                )}
              </View>
            </Animated.View>

            {/* ANTI-CHEAT ALERTS LOG */}
            <Animated.View layout={LinearTransition.springify()}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardHeaderTop}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={[styles.iconBox, { backgroundColor: 'rgba(251, 191, 36, 0.1)', borderColor: 'rgba(251, 191, 36, 0.2)' }]}>
                      <Shield size={20} color={colors.amber} />
                    </View>
                    <View>
                      <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Anti-Cheat Alerts Log</Text>
                      <Text style={[styles.cardSubtitle, { color: colors.textDim }]}>All violations detected during sessions</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={styles.exportRowMini}>
                      <TouchableOpacity onPress={() => handleExport('JSON')}><Text style={[styles.exportMiniText, { color: colors.accent }]}>JSON</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => handleExport('CSV')}><Text style={[styles.exportMiniText, { color: colors.emerald }]}>CSV</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => handleExport('PDF')}><Text style={[styles.exportMiniText, { color: colors.amber }]}>PDF</Text></TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => setOpenAlerts(!openAlerts)} style={[styles.previewToggleBtn, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                      <Text style={[styles.previewToggleText, { color: colors.textSecondary }]}>{openAlerts ? '▲ Hide preview' : '▼ Preview data'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {openAlerts && (
                  <View style={[styles.expandedPreview, { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)' }]}>
                    <ScrollView nestedScrollEnabled>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View>
                        <View style={[styles.tableRow, { borderBottomColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                          <Text style={[styles.th, { color: colors.textDim, width: 80 }]}>ROOM</Text>
                          <Text style={[styles.th, { color: colors.textDim, width: 140 }]}>HOST</Text>
                          <Text style={[styles.th, { color: colors.textDim, width: 120 }]}>TYPE</Text>
                          <Text style={[styles.th, { color: colors.textDim, width: 200 }]}>MESSAGE</Text>
                          <Text style={[styles.th, { color: colors.textDim, width: 60 }]}>PENALTY</Text>
                          <Text style={[styles.th, { color: colors.textDim, width: 140 }]}>TIME</Text>
                        </View>
                        {alertsData.slice(0, 10).map((a: any, i: number) => (
                          <View key={i} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
                            <Text style={[styles.td, { color: colors.accent, width: 80 }]} numberOfLines={1}>{a.roomId ? (a.roomId.length >= 8 ? `${a.roomId.slice(0, 4)}·${a.roomId.slice(4, 8)}` : a.roomId) : 'SYS'}</Text>
                            <Text style={[styles.td, { color: colors.textPrimary, width: 140 }]} numberOfLines={1}>{a.hostEmail || 'Unknown'}</Text>
                            <View style={{ width: 120, justifyContent: 'center' }}>
                              <Text style={[styles.roleBadge, { color: colors.amber, backgroundColor: colors.amber + '20', borderColor: colors.amber + '40' }]} numberOfLines={1}>{a.eventType || a.type || 'Violation'}</Text>
                            </View>
                            <Text style={[styles.td, { color: colors.textSecondary, width: 200 }]} numberOfLines={1}>{a.message}</Text>
                            <Text style={[styles.td, { color: colors.red, width: 60, fontWeight: 'bold' }]}>+{a.penalty || 0}</Text>
                            <Text style={[styles.td, { color: colors.textDim, width: 140 }]} numberOfLines={1}>{formatDate(a.time || a.timestamp)}</Text>
                          </View>
                        ))}
                        </View>
                      </ScrollView>
                    </ScrollView>
                  </View>
                )}
              </View>
            </Animated.View>
            
            {/* FULL ACTIVITY REPORT */}
            <Animated.View layout={LinearTransition.springify()}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardHeaderTop}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={[styles.iconBox, { backgroundColor: 'rgba(110, 63, 255, 0.1)', borderColor: 'rgba(110, 63, 255, 0.2)' }]}>
                      <FileText size={20} color={colors.violet} />
                    </View>
                    <View>
                      <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Full Activity Report</Text>
                      <Text style={[styles.cardSubtitle, { color: colors.textDim }]}>Combined export of all system activity</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={styles.exportRowMini}>
                      <TouchableOpacity onPress={() => handleExport('JSON')}><Text style={[styles.exportMiniText, { color: colors.accent }]}>JSON</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => handleExport('CSV')}><Text style={[styles.exportMiniText, { color: colors.emerald }]}>CSV</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => handleExport('PDF')}><Text style={[styles.exportMiniText, { color: colors.amber }]}>PDF</Text></TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => setOpenFull(!openFull)} style={[styles.previewToggleBtn, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                      <Text style={[styles.previewToggleText, { color: colors.textSecondary }]}>{openFull ? '▲ Hide preview' : '▼ Preview data'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {openFull && (
                  <View style={[styles.expandedPreview, { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)', padding: 16 }]}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                      <View style={[styles.miniMetricCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                        <Text style={[styles.miniMetricLabel, { color: colors.textDim }]}>TOTAL USERS</Text>
                        <Text style={[styles.miniMetricValue, { color: colors.textPrimary }]}>{userActivity.length}</Text>
                      </View>
                      <View style={[styles.miniMetricCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                        <Text style={[styles.miniMetricLabel, { color: colors.textDim }]}>TOTAL SESSIONS</Text>
                        <Text style={[styles.miniMetricValue, { color: colors.textPrimary }]}>{totalSessions}</Text>
                      </View>
                      <View style={[styles.miniMetricCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                        <Text style={[styles.miniMetricLabel, { color: colors.textDim }]}>TOTAL ALERTS</Text>
                        <Text style={[styles.miniMetricValue, { color: colors.textPrimary }]}>{alertsData.length}</Text>
                      </View>
                      <View style={[styles.miniMetricCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                        <Text style={[styles.miniMetricLabel, { color: colors.textDim }]}>VERIFIED USERS</Text>
                        <Text style={[styles.miniMetricValue, { color: colors.textPrimary }]}>{userActivity.filter((u:any) => u.isVerified).length}</Text>
                      </View>
                      <View style={[styles.miniMetricCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                        <Text style={[styles.miniMetricLabel, { color: colors.textDim }]}>BLOCKED USERS</Text>
                        <Text style={[styles.miniMetricValue, { color: colors.textPrimary }]}>{userActivity.filter((u:any) => u.banned).length}</Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </Animated.View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  baseBg: { ...StyleSheet.absoluteFill },
  gridBg: { ...StyleSheet.absoluteFill },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 40, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)', zIndex: 20 },
  iconBtn: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  headerTitle: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  headerSubtitle: { fontSize: 10, fontFamily: 'SpaceMono', marginTop: 4 },
  scrollView: { flex: 1, paddingHorizontal: 16 },
  listContainer: { paddingBottom: 100, paddingTop: 16, gap: 16 },
  
  dataCardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 },
  dataCard: { width: (width - 44) / 2, padding: 16, borderRadius: 12, borderWidth: 1 },
  dataCardLabel: { fontSize: 11, fontFamily: 'SpaceMono' },
  dataCardValue: { fontSize: 24, fontFamily: 'Inter_700Bold', marginTop: 8 },
  dataCardIconBox: { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  
  card: { borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  cardHeaderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20 },
  iconBox: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  cardTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  cardSubtitle: { fontSize: 11, fontFamily: 'SpaceMono', maxWidth: 160 },
  
  exportRowMini: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  exportMiniText: { fontSize: 10, fontFamily: 'SpaceMono', fontWeight: 'bold', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  previewToggleBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, alignSelf: 'flex-end' },
  previewToggleText: { fontSize: 9, fontFamily: 'SpaceMono' },
  
  expandedPreview: { maxHeight: 300 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  th: { fontSize: 10, fontFamily: 'SpaceMono', fontWeight: 'bold' },
  td: { fontSize: 11, fontFamily: 'SpaceMono', paddingRight: 12 },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, alignSelf: 'flex-start', fontSize: 9, fontFamily: 'SpaceMono', fontWeight: 'bold' },
  
  miniMetricCard: { padding: 12, borderRadius: 8, borderWidth: 1, width: (width - 80) / 2 },
  miniMetricLabel: { fontSize: 9, fontFamily: 'SpaceMono', marginBottom: 4 },
  miniMetricValue: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  
  errorContainer: { padding: 20, borderRadius: 12, borderWidth: 1 },
  errorText: { textAlign: 'center', fontFamily: 'SpaceMono', fontSize: 12, fontWeight: 'bold' }
});
