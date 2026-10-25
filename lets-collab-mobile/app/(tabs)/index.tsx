// Force Metro Cache Invalidation
import { StyleSheet, View, Text, ScrollView, RefreshControl, TouchableOpacity, Dimensions, Animated, Easing, ImageBackground, LogBox, TextInput } from 'react-native';

LogBox.ignoreLogs(['Unknown event handler property `onPressIn`']);
import { useState, useEffect, useRef } from 'react';
import { ShieldAlert, Users, LogOut, Sun, Moon, Sparkles, Activity, MonitorPlay, LogIn } from 'lucide-react-native';
import { BarChart, LineChart } from 'react-native-chart-kit';
import { getAuthHeaders, getStoredRole, BACKEND_URL } from '../../lib/api';
import { signOutAdmin, useAdminReports, useAdminSocket, useServerHealth } from '../../lib/adminData';
import { router, Href } from 'expo-router';
import { normalizeRoomCode } from '../../lib/liveSession';
import { useTheme } from '../../context/ThemeContext';
import { AppLogo } from '../../components/AppLogo';
import { ActivityHeatmap } from '../../components/ActivityHeatmap';

if (typeof console !== 'undefined') {
  const originalConsoleError = console.error;
  console.error = (...args) => {
    if (args.some(arg => typeof arg === 'string' && arg.includes('transform-origin'))) {
      return;
    }
    originalConsoleError(...args);
  };
}

const { width } = Dimensions.get('window');



// The server's answer to a signed-in account that is not an administrator (server/adminRoutes.js protectAdmin)
const NOT_ADMIN = /not authorized (as an admin|for this account)/i;

/** "Oct 25, 14": the hour bucket label used by the web overview's alerts chart. */
function hourLabel(hour: number) {
  const d = new Date(hour);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${String(d.getHours()).padStart(2, '0')}`;
}

export default function TabOneScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  // Shared, cached report (lib/adminData): instant when coming back to this tab
  const { data, error, refresh } = useAdminReports();
  const { status: socketStatus } = useAdminSocket();
  const { health, unreachable } = useServerHealth();
  const [refreshing, setRefreshing] = useState(false);
  // Non-admin accounts (students, participants) use this tab only to join a session
  const [storedRole, setStoredRole] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const isDark = theme === 'dark' || theme === 'glassmorphic';

  useEffect(() => {
    getStoredRole().then(setStoredRole).catch(() => setStoredRole(null));
  }, []);

  // Participant mode: the stored role says so, or the report was refused with the not-an-admin 403.
  // Any other report error is shown as an error, not hidden behind the join box.
  const participantOnly = storedRole === 'user' || (!data && !!error && NOT_ADMIN.test(error));
  
  const dynamicChartConfig = {
    backgroundGradientFrom: colors.surface,
    backgroundGradientTo: colors.surface,
    color: (opacity = 1) => isDark ? `rgba(255, 255, 255, ${opacity})` : `rgba(0, 0, 0, ${opacity})`,
    labelColor: (opacity = 1) => colors.textDim,
    strokeWidth: 2,
    barPercentage: 0.5,
    useShadowColorFromDataset: false,
    propsForDots: {
      r: "4",
      strokeWidth: "2",
      stroke: colors.accent
    }
  };
  
  // Animation for page load
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      })
    ]).start();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };

  const handleJoinSession = () => {
    const code = normalizeRoomCode(joinCode);
    if (!code) return;
    setJoinCode('');
    router.push(`/session/${code}` as Href);
  };

  const handleLogout = async () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -20, duration: 300, useNativeDriver: true })
    ]).start(async () => {
      // Clears the server's auth cookie; the stored token is removed either way
      try {
        await fetch(`${BACKEND_URL}/api/auth/logout`, { method: 'POST', headers: await getAuthHeaders() });
      } catch { /* offline: signing out locally is enough */ }
      await signOutAdmin();
    });
  };

  const users: any[] = data?.userActivity || [];
  const alerts: any[] = data?.alerts || [];
  const totalUsers = users.length;
  const openAlerts = alerts.filter((a: any) => !a.falsePositive).length;
  const verifiedCount = users.filter((u: any) => u.isVerified).length;
  // Open alerts raised in the last 24 hours decide the posture shown at the bottom
  const recentOpenAlerts = alerts.filter((a: any) => !a.falsePositive && Date.now() - new Date(a.time).getTime() < 86400000).length;

  // Rooms hosted per user: the 10 busiest hosts
  const activityData = [...users]
    .sort((a: any, b: any) => (b.sessionCount || 0) - (a.sessionCount || 0))
    .slice(0, 10);
  const activityLabels = activityData.length > 0 ? activityData.map((u: any) => u.name?.split(' ')[0] || "User") : ["No Data"];
  const activityValues = activityData.length > 0 ? activityData.map((u: any) => u.sessionCount || 0) : [0];

  // Alerts per hour, oldest to newest, for the latest 15 hours that had any (the API lists newest first)
  const alertsPerHour = new Map<number, number>();
  for (const a of alerts) {
    const time = new Date(a.time).getTime();
    if (Number.isNaN(time)) continue;
    const hour = Math.floor(time / 3600000) * 3600000;
    alertsPerHour.set(hour, (alertsPerHour.get(hour) || 0) + 1);
  }
  const alertAgg = Array.from(alertsPerHour.entries()).sort(([a], [b]) => a - b).slice(-15);
  const alertLabels = alertAgg.length > 0 ? alertAgg.map(([hour]) => hourLabel(hour)) : ["Now"];
  const alertValues = alertAgg.length > 0 ? alertAgg.map(([, count]) => count) : [0];

  // Same rules as the web dashboard's SystemStatus badge
  const statusBadge = unreachable
    ? { label: 'Server unreachable', color: colors.red }
    : !health || socketStatus !== 'connected'
      ? { label: 'Connecting…', color: colors.textDim }
      : !health.dbConnected
        ? { label: 'Database offline', color: colors.amber }
        : { label: health.blockchainActive ? 'System Online' : 'Online · chain off', color: colors.emerald };

  const isGlass = theme === 'glassmorphic';
  
  const blurTint = isDark ? "dark" : "light";
  const { width } = Dimensions.get('window');
  
  // Calculate dynamic width for BarChart so names don't overlap horizontally without rotating
  const dynamicBarWidth = Math.max(width - 64, activityLabels.length * 120);
  const dynamicLineWidth = Math.max(width - 64, alertLabels.length * 80);
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.baseBg, { backgroundColor: colors.bg }]} />

      <ImageBackground 
        source={require('../../assets/images/grid.svg')} 
        style={styles.gridBg}
        imageStyle={{ opacity: isDark ? 0.08 : 0.03, resizeMode: 'repeat' }}
      />

      <ScrollView 
        style={styles.scrollView} 
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <View style={styles.header}>
            <AppLogo size="small" />
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={toggleTheme} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface, marginRight: 8 }]}>
                {isDark ? <Sun size={16} color={colors.textSecondary} /> : <Moon size={16} color={colors.textSecondary} />}
              </TouchableOpacity>
              <TouchableOpacity onPress={handleLogout} style={[styles.logoutBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <LogOut color={colors.textDim} size={16} style={{ marginRight: 6 }} />
                <Text style={[styles.logoutText, { color: colors.textSecondary }]}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>

          {!participantOnly && (
            <View style={styles.statusRow}>
              <View style={[styles.statusBadge, { borderColor: statusBadge.color + '55', backgroundColor: statusBadge.color + '18' }]}>
                <View style={[styles.statusDot, { backgroundColor: statusBadge.color }]} />
                <Text style={[styles.statusBadgeText, { color: statusBadge.color }]}>{statusBadge.label}</Text>
              </View>
              {data?.mock && (
                <View style={[styles.statusBadge, { borderColor: colors.amber + '55', backgroundColor: colors.amber + '18' }]}>
                  <Text style={[styles.statusBadgeText, { color: colors.amber }]}>MOCK DATA (database offline)</Text>
                </View>
              )}
            </View>
          )}

          <View style={[styles.joinCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.joinHeader}>
              <View style={[styles.iconWrapper, { backgroundColor: 'rgba(0, 212, 255, 0.1)', borderColor: 'rgba(0, 212, 255, 0.2)', marginBottom: 0, marginRight: 12 }]}>
                <MonitorPlay color={colors.accent} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardLabel, { color: colors.textDim }]}>LIVE SESSION</Text>
                <Text style={[styles.joinTitle, { color: colors.textPrimary }]}>Join as participant</Text>
              </View>
            </View>
            <View style={styles.joinRow}>
              <TextInput
                value={joinCode}
                onChangeText={value => setJoinCode(normalizeRoomCode(value))}
                placeholder="ROOM CODE"
                placeholderTextColor={colors.textDim}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleJoinSession}
                style={[styles.joinInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.elevated }]}
              />
              <TouchableOpacity
                onPress={handleJoinSession}
                disabled={!joinCode}
                style={[styles.joinBtn, { backgroundColor: colors.accent, opacity: joinCode ? 1 : 0.5 }]}
              >
                <LogIn color="#080810" size={16} style={{ marginRight: 6 }} />
                <Text style={styles.joinBtnText}>Join</Text>
              </TouchableOpacity>
            </View>
          </View>

          {participantOnly ? (
            <View style={[styles.errorContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>Enter the room code from your host or exam invite above to join a session. Analytics are only shown to administrators.</Text>
            </View>
          ) : error && !data ? (
            <View style={[styles.errorContainer, { backgroundColor: isDark ? 'rgba(255, 59, 92, 0.1)' : 'rgba(255, 59, 92, 0.05)', borderColor: isDark ? 'rgba(255, 59, 92, 0.3)' : 'rgba(255, 59, 92, 0.2)' }]}>
              <Text style={[styles.errorText, { color: colors.red }]}>Could not load analytics: {error}</Text>
            </View>
          ) : !data ? (
            <View style={[styles.errorContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.errorText, { color: colors.textDim }]}>Loading platform analytics…</Text>
            </View>
          ) : (
            <>
              {error ? (
                <View style={[styles.errorContainer, { marginBottom: 0, backgroundColor: isDark ? 'rgba(255, 59, 92, 0.1)' : 'rgba(255, 59, 92, 0.05)', borderColor: isDark ? 'rgba(255, 59, 92, 0.3)' : 'rgba(255, 59, 92, 0.2)' }]}>
                  <Text style={[styles.errorText, { color: colors.red }]}>Showing the last report; refreshing failed: {error}</Text>
                </View>
              ) : null}
              <View style={styles.statsGrid}>
                <Text style={[styles.chartTitle, { color: colors.textPrimary, marginBottom: 0, marginLeft: 4 }]}>System Activity History</Text>
                <ActivityHeatmap sessions={data?.sessionHistory || []} />
              </View>

              <View style={styles.cardContainer}>
                <View style={[styles.statCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <View style={styles.cardInner}>
                    <View style={[styles.iconWrapper, { backgroundColor: 'rgba(110, 63, 255, 0.1)', borderColor: 'rgba(110, 63, 255, 0.2)' }]}>
                      <Users color={colors.violet} size={20} style={styles.glowViolet} />
                    </View>
                    <View>
                      <Text style={[styles.cardLabel, { color: colors.textDim }]}>TOTAL USERS</Text>
                      <Text style={[styles.cardValue, { color: colors.textPrimary }]}>{totalUsers}</Text>
                    </View>
                  </View>
                </View>

                <View style={[styles.statCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <View style={styles.cardInner}>
                    <View style={[styles.iconWrapper, { backgroundColor: 'rgba(240, 165, 0, 0.1)', borderColor: 'rgba(240, 165, 0, 0.2)' }]}>
                      <ShieldAlert color={colors.amber} size={20} style={styles.glowAmber} />
                    </View>
                    <View>
                      <Text style={[styles.cardLabel, { color: colors.textDim }]}>OPEN ALERTS</Text>
                      <Text style={[styles.cardValue, { color: colors.textPrimary }]}>{openAlerts}</Text>
                    </View>
                  </View>
                </View>

                <View style={[styles.statCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <View style={styles.cardInner}>
                    <View style={[styles.iconWrapper, { backgroundColor: 'rgba(0, 196, 140, 0.1)', borderColor: 'rgba(0, 196, 140, 0.2)' }]}>
                      <Activity color={colors.emerald} size={20} style={styles.glowEmerald} />
                    </View>
                    <View>
                      <Text style={[styles.cardLabel, { color: colors.textDim }]}>VERIFIED</Text>
                      <Text style={[styles.cardValue, { color: colors.textPrimary }]}>{verifiedCount}</Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={[styles.chartContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.chartTitle, { color: colors.textPrimary }]}>Rooms Hosted per User</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <BarChart
                    data={{
                      labels: activityLabels,
                      datasets: [{ data: activityValues }]
                    }}
                    width={dynamicBarWidth}
                    height={280}
                    yAxisLabel=""
                    yAxisSuffix=""
                    fromZero={true}
                    showValuesOnTopOfBars={true}
                    chartConfig={{
                      ...dynamicChartConfig,
                      // BarChart reads formatYLabel from chartConfig (it is not a BarChart prop).
                      formatYLabel: (yValue: string) => Math.round(parseFloat(yValue)).toString(),
                      color: (opacity = 1) => `rgba(110, 63, 255, ${opacity})`,
                      propsForLabels: { fontSize: 10 }
                    }}
                    style={{ borderRadius: 12, marginTop: 8, paddingRight: 30, paddingBottom: 10 }}
                  />
                </ScrollView>
              </View>

              <View style={[styles.chartContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.chartTitle, { color: colors.textPrimary }]}>Anti-Cheat Alerts per Hour</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <LineChart
                    data={{
                      labels: alertLabels,
                      datasets: [{ data: alertValues }]
                    }}
                    width={dynamicLineWidth}
                    height={220}
                    yAxisLabel=""
                    yAxisSuffix=""
                    formatYLabel={(yValue) => Math.round(parseFloat(yValue)).toString()}
                    fromZero={true}
                    withDots={false}
                    chartConfig={{
                      ...dynamicChartConfig,
                      color: (opacity = 1) => `rgba(255, 59, 92, ${opacity})`,
                      propsForLabels: { fontSize: 8 },
                      propsForDots: { r: "4", strokeWidth: "2", stroke: "#ff3b5c" }
                    }}
                    bezier
                    style={{ borderRadius: 12, marginTop: 8, paddingRight: 30 }}
                  />
                </ScrollView>
              </View>

              <View style={[styles.fullCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <View style={styles.riskHeader}>
                  <View style={[styles.riskDot, recentOpenAlerts > 0 && styles.riskDotActive]} />
                  <Text style={[styles.riskTitle, { color: colors.textPrimary }]}>Security Posture</Text>
                </View>
                
                <View style={styles.riskBody}>
                  <View style={styles.riskScore}>
                    <Text style={[styles.riskNumber, { color: recentOpenAlerts > 0 ? colors.amber : colors.emerald }]}>
                      {recentOpenAlerts > 0 ? 'REVIEW' : 'CLEAR'}
                    </Text>
                    <Text style={[styles.riskSubtitle, { color: colors.textDim }]}>OPEN ALERTS, LAST 24 H</Text>
                  </View>
                  
                  <View style={styles.riskStats}>
                    <View style={styles.riskStatItem}>
                      <Text style={[styles.riskStatValue, { color: colors.textPrimary }]}>{recentOpenAlerts}</Text>
                      <Text style={[styles.riskStatLabel, { color: colors.textSecondary }]}>Alerts (24 h)</Text>
                    </View>
                    <View style={styles.riskDivider} />
                    <View style={styles.riskStatItem}>
                      <Text style={[styles.riskStatValue, { color: colors.textPrimary }]}>{typeof data?.activeSessions === 'number' ? data.activeSessions : '—'}</Text>
                      <Text style={[styles.riskStatLabel, { color: colors.textSecondary }]}>Online Users</Text>
                    </View>
                  </View>
                </View>
              </View>
            </>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  baseBg: {
    ...StyleSheet.absoluteFill,
  },
  gridBg: {
    ...StyleSheet.absoluteFill,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 24,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  logoutText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: -12,
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  statusBadgeText: {
    fontFamily: 'SpaceMono',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  joinCard: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  joinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  joinTitle: {
    fontFamily: 'Inter_900Black',
    fontSize: 16,
  },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  joinInput: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontFamily: 'SpaceMono',
    fontSize: 14,
    letterSpacing: 2,
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  joinBtnText: {
    color: '#080810',
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  errorContainer: {
    margin: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  statsGrid: {
    paddingHorizontal: 20,
    marginTop: 20,
    paddingBottom: 20,
  },
  chartTitle: {
    fontFamily: 'Inter_900Black',
    fontSize: 16,
    marginBottom: 12,
  },
  cardContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardInner: {
    padding: 12,
  },
  chartContainer: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
  },
  cardLabel: {
    fontFamily: 'SpaceMono',
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  cardValue: {
    fontFamily: 'Inter_900Black',
    fontSize: 32,
    letterSpacing: -1,
  },
  fullCard: {
    marginHorizontal: 16,
    borderRadius: 48,
    borderWidth: 1,
    padding: 30,
    marginBottom: 110,
    overflow: 'hidden',
    shadowColor: '#00d4ff',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    elevation: 10,
  },
  riskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  riskDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00c48c',
    marginRight: 10,
  },
  riskDotActive: {
    backgroundColor: '#ff3b5c',
  },
  riskTitle: {
    fontFamily: 'Inter_900Black',
    fontSize: 18,
  },
  riskBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  riskScore: {
    flex: 1,
  },
  riskNumber: {
    fontFamily: 'Inter_900Black',
    fontSize: 36,
    marginBottom: 2,
  },
  riskSubtitle: {
    fontFamily: 'SpaceMono',
    fontSize: 10,
    letterSpacing: 1,
  },
  riskStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  riskStatItem: {
    alignItems: 'flex-end',
  },
  riskStatValue: {
    fontFamily: 'Inter_900Black',
    fontSize: 24,
    marginBottom: 2,
  },
  riskStatLabel: {
    fontFamily: 'SpaceMono',
    fontSize: 10,
  },
  riskDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  glowViolet: {
    shadowColor: '#6e3fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
  },
  glowAmber: {
    shadowColor: '#f0a500',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
  },
  glowEmerald: {
    shadowColor: '#00c48c',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
  }
});
