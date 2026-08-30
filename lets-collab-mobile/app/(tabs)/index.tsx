// Force Metro Cache Invalidation
import { StyleSheet, View, Text, ScrollView, RefreshControl, TouchableOpacity, Dimensions, Animated, Easing, ImageBackground, LogBox } from 'react-native';

LogBox.ignoreLogs(['Unknown event handler property `onPressIn`']);
import { BlurView } from 'expo-blur';
import { useState, useEffect, useRef } from 'react';
import { ShieldAlert, Users, LogOut, Sun, Moon, Sparkles, Activity } from 'lucide-react-native';
import { BarChart, LineChart } from 'react-native-chart-kit';
import { getAuthHeaders, removeAuthToken, BACKEND_URL } from '../../lib/api';
import { router } from 'expo-router';
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



export default function TabOneScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [debugResponse, setDebugResponse] = useState<string>("");
  const isDark = theme === 'dark' || theme === 'glassmorphic';
  
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

  const fetchAnalytics = async () => {
    try {
      const headers = await getAuthHeaders();
      const noCacheUrl = `${BACKEND_URL}/api/admin/reports?_t=${Date.now()}`;
      setDebugResponse("Fetching from " + noCacheUrl);
      
      const response = await fetch(noCacheUrl, { 
        headers: {
          ...headers,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        } 
      });
      
      if (response.status === 401 || response.status === 403) {
        console.warn("Unauthorized, logging out...");
        setDebugResponse("Status " + response.status + " Logging out");
        handleLogout();
        return;
      }

      const text = await response.text();
      setDebugResponse("Status " + response.status + " Text: " + text.substring(0, 100));
      let json = null;
      try {
         json = JSON.parse(text);
      } catch (e) {
         setDebugResponse("Status " + response.status + " Parse Error");
      }
      
      if (response.ok && json && json.success) {
        setData(json);
        setError(false);
      } else {
        console.error("Backend error:", response.status, json);
        setError(true);
      }
    } catch (e: any) {
      console.error("Fetch exception:", e);
      setDebugResponse("Fetch exception: " + e.message);
      setError(true);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAnalytics();
    setRefreshing(false);
  };

  const handleLogout = async () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -20, duration: 300, useNativeDriver: true })
    ]).start(async () => {
      await removeAuthToken();
      router.replace('/login');
    });
  };

  const totalUsers = data?.userActivity?.length || 0;
  const totalAlerts = data?.alerts?.length || 0;
  
  // High risk logic based on actual data
  const highRiskCount = data?.alerts?.filter((a: any) => a.riskLevel === 'high' || a.type === 'UNAUTHORIZED_ACCESS').length || 0;
  
  const activityData = (data?.userActivity || []);
  const activityLabels = activityData.length > 0 ? activityData.map((u: any) => u.name || "User") : ["No Data"];
  const activityValues = activityData.length > 0 ? activityData.map((u: any) => u.sessionCount || 0) : [0];

  const alertAgg = (data?.alerts || []).reduce((acc: any, a: any) => {
    const d = new Date(a.time || a.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const ev = acc.find((e: any) => e.time === d);
    if (ev) ev.alerts += 1;
    else acc.push({ time: d, alerts: 1 });
    return acc;
  }, []);
  const alertLabels = alertAgg.length > 0 ? alertAgg.map((a: any) => a.time) : ["Now"];
  const alertValues = alertAgg.length > 0 ? alertAgg.map((a: any) => a.alerts) : [0];

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

          {error ? (
            <View style={[styles.errorContainer, { backgroundColor: isDark ? 'rgba(255, 59, 92, 0.1)' : 'rgba(255, 59, 92, 0.05)', borderColor: isDark ? 'rgba(255, 59, 92, 0.3)' : 'rgba(255, 59, 92, 0.2)' }]}>
              <Text style={[styles.errorText, { color: colors.red }]}>Could not connect to backend analytics.</Text>
            </View>
          ) : (
            <>
              <View style={styles.statsGrid}>
                {/* Debug info kept for user verification */}
                <Text style={{color: 'red', fontSize: 10, position: 'absolute', top: -15, zIndex: 10}}>Debug Info: data is {data ? "present" : "null"}</Text>
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
                      <Text style={[styles.cardLabel, { color: colors.textDim }]}>ACTIVE ALERTS</Text>
                      <Text style={[styles.cardValue, { color: colors.textPrimary }]}>{totalAlerts}</Text>
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
                      <Text style={[styles.cardValue, { color: colors.textPrimary }]}>{totalUsers > 0 ? totalUsers - 1 : 0}</Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={[styles.chartContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.chartTitle, { color: colors.textPrimary }]}>User Session Activity</Text>
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
                    formatYLabel={(yValue) => Math.round(parseFloat(yValue)).toString()}
                    fromZero={true}
                    showValuesOnTopOfBars={true}
                    chartConfig={{
                      ...dynamicChartConfig,
                      color: (opacity = 1) => `rgba(110, 63, 255, ${opacity})`,
                      propsForLabels: { fontSize: 10 }
                    }}
                    style={{ borderRadius: 12, marginTop: 8, paddingRight: 30, paddingBottom: 10 }}
                  />
                </ScrollView>
              </View>

              <View style={[styles.chartContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.chartTitle, { color: colors.textPrimary }]}>Anti-Cheat Alert Frequency</Text>
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
                  <View style={[styles.riskDot, highRiskCount > 0 && styles.riskDotActive]} />
                  <Text style={[styles.riskTitle, { color: colors.textPrimary }]}>Security Posture</Text>
                </View>
                
                <View style={styles.riskBody}>
                  <View style={styles.riskScore}>
                    <Text style={[styles.riskNumber, { color: highRiskCount > 0 ? colors.red : colors.emerald }]}>
                      {highRiskCount > 0 ? 'HIGH' : 'LOW'}
                    </Text>
                    <Text style={[styles.riskSubtitle, { color: colors.textDim }]}>CURRENT RISK</Text>
                  </View>
                  
                  <View style={styles.riskStats}>
                    <View style={styles.riskStatItem}>
                      <Text style={[styles.riskStatValue, { color: colors.textPrimary }]}>{highRiskCount}</Text>
                      <Text style={[styles.riskStatLabel, { color: colors.textSecondary }]}>Critical Events</Text>
                    </View>
                    <View style={styles.riskDivider} />
                    <View style={styles.riskStatItem}>
                      <Text style={[styles.riskStatValue, { color: colors.textPrimary }]}>{data?.activeSessions || 0}</Text>
                      <Text style={[styles.riskStatLabel, { color: colors.textSecondary }]}>Active Nodes</Text>
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
