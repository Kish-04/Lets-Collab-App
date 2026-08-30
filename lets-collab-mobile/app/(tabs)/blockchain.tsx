import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, ImageBackground, Platform } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { BACKEND_URL, getStoredAuthToken } from '../../lib/api';
import { RefreshCw, Network, Link as LinkIcon, Database, CheckCircle, Clock, Wifi, WifiOff, Sun, Moon } from 'lucide-react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import io, { Socket } from 'socket.io-client';

export default function BlockchainScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark' || theme === 'glassmorphic';
  
  const [chainData, setChainData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [lastSynced, setLastSynced] = useState<string>("");
  
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const init = async () => {
      const token = await getStoredAuthToken();
      if (!token) return;
      
      const socket = io(BACKEND_URL, { auth: { token }, withCredentials: true, transports: ['websocket'] });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('query-chain');
      });

      socket.on('chain-data', (data: any) => {
        setChainData(data);
        setLoading(false);
        setSyncing(false);
        setLastSynced(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      });

      socket.on('chain-log', () => {
        socket.emit('query-chain');
      });
    };

    init();
    return () => { socketRef.current?.disconnect(); };
  }, []);

  const handleSync = () => {
    if (syncing) return;
    setSyncing(true);
    socketRef.current?.emit('query-chain');
  };

  const logs = chainData?.logs || [];
  const allEventTypes = Array.from(new Set(logs.map((l: any) => l.eventType)));
  const filtered = filterType === "all" ? logs : logs.filter((l: any) => l.eventType === filterType);

  const getEventStyle = (type: string) => {
    switch (type) {
      case 'ROOM_CREATED':
      case 'SESSION_START': return { bg: 'rgba(0,196,140,0.2)', text: colors.emerald, border: 'rgba(0,196,140,0.3)' };
      case 'USER_JOINED':
      case 'JOIN': return { bg: 'rgba(110,63,255,0.2)', text: colors.violet, border: 'rgba(110,63,255,0.3)' };
      case 'PERMISSION_CHANGE': return { bg: 'rgba(0,212,255,0.2)', text: colors.accent, border: 'rgba(0,212,255,0.3)' };
      case 'KILL_SWITCH': return { bg: 'rgba(255,59,92,0.2)', text: colors.red, border: 'rgba(255,59,92,0.3)' };
      case 'ANTICHEAT_ALERT': return { bg: 'rgba(240,165,0,0.2)', text: colors.amber, border: 'rgba(240,165,0,0.3)' };
      default: return { bg: 'rgba(255,255,255,0.1)', text: colors.textPrimary, border: 'rgba(255,255,255,0.2)' };
    }
  };
  const truncateHash = (hash: string) => hash ? `${hash.slice(0, 8)}...${hash.slice(-6)}` : '—';

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
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Blockchain Audit</Text>
          {chainData && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
              <View style={[styles.networkBadge, { backgroundColor: 'rgba(110,63,255,0.2)', borderColor: 'rgba(110,63,255,0.4)' }]}>
                <Text style={[styles.networkText, { color: colors.violet }]}>SEPOLIA TESTNET</Text>
              </View>
              <View style={styles.metricCard}>
                <View style={[styles.metricIcon, { backgroundColor: chainData.active ? 'rgba(0,196,140,0.1)' : 'rgba(240,165,0,0.1)' }]}>
                  {chainData.active ? <Wifi size={14} color={colors.emerald} /> : <WifiOff size={14} color={colors.amber} />}
                </View>
                <Text style={[styles.statusText, { color: chainData.active ? colors.emerald : colors.amber }]}>
                  {chainData.active ? 'CONNECTED' : 'MOCK MODE'}
                </Text>
              </View>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity 
            onPress={handleSync} 
            style={[styles.syncBtn, { backgroundColor: isDark ? 'rgba(0,212,255,0.1)' : 'rgba(0,212,255,0.05)', borderColor: isDark ? 'rgba(0,212,255,0.3)' : 'rgba(0,212,255,0.15)' }]}
          >
            {syncing ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={16} color={colors.accent} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleTheme} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {isDark ? <Sun size={16} color={colors.textSecondary} /> : <Moon size={16} color={colors.textSecondary} />}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.listContainer}>
        <View style={styles.statsContainer}>
          <View style={[styles.statCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.statInner}>
              <Text style={[styles.statLabel, { color: colors.textDim }]}>TOTAL LOGGED</Text>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>{loading ? '...' : (chainData?.totalCount ?? 0)}</Text>
            </View>
          </View>
          <View style={[styles.statCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.statInner}>
              <Text style={[styles.statLabel, { color: colors.textDim }]}>CURRENT BLOCK</Text>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>{loading ? '...' : chainData?.currentBlock ? `#${chainData.currentBlock.toLocaleString()}` : '—'}</Text>
            </View>
          </View>
        </View>

        {logs.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll} style={styles.filters}>
            {['all', 'SYSTEM', 'SESSION', 'EVIDENCE'].map((type) => (
              <TouchableOpacity
                key={type}
                onPress={() => setFilterType(type)}
                style={[styles.filterBtn, filterType === type ? { backgroundColor: colors.accent, borderColor: colors.accent } : { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[styles.filterText, { color: filterType === type ? colors.bg : colors.textPrimary }]}>
                  {type.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} />
        ) : (
          filtered.map((log: any, i: number) => {
            const style = getEventStyle(log.eventType);
            const isExpanded = expandedRow === i;
            return (
              <Animated.View key={i} entering={FadeInDown.delay(i * 50)} style={[styles.logCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <AnimatedPressable onPress={() => setExpandedRow(isExpanded ? null : i)} style={styles.logHeader}>
                  <View>
                    <Text style={[styles.logType, { color: style.text, backgroundColor: style.bg }]}>{log.eventType}</Text>
                    <Text style={[styles.logHash, { color: colors.textSecondary, marginTop: 4 }]}>{truncateHash(log.txHash)}</Text>
                  </View>
                  <Text style={[styles.logBlock, { color: colors.textPrimary }]}>#{log.blockNumber}</Text>
                </AnimatedPressable>
                {isExpanded && (
                  <View style={[styles.expandedContent, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textDim }]}>Session ID</Text>
                      <Text style={[styles.detailValue, { color: colors.textPrimary }]}>{log.sessionId}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.textDim }]}>Timestamp</Text>
                      <Text style={[styles.detailValue, { color: colors.textPrimary }]}>{log.timestamp}</Text>
                    </View>
                  </View>
                )}
              </Animated.View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  baseBg: { ...StyleSheet.absoluteFill },
  gridBg: { ...StyleSheet.absoluteFill },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 40, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  headerTitle: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  networkBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  networkText: { fontSize: 10, fontFamily: 'SpaceMono' },
  statusText: { fontSize: 9, fontFamily: 'SpaceMono', fontWeight: 'bold', letterSpacing: 1 },
  metricCard: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricIcon: { width: 24, height: 24, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  syncBtn: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  scrollView: { flex: 1, paddingHorizontal: 16 },
  listContainer: { paddingBottom: 100, gap: 12 },
  statsContainer: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statCard: { flex: 1, borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  statInner: { padding: 16 },
  statLabel: { fontSize: 10, fontFamily: 'SpaceMono', letterSpacing: 1, marginBottom: 4 },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  filters: { flexDirection: 'row', paddingVertical: 16 },
  filterScroll: { gap: 8, paddingRight: 32 },
  filterBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  filterText: { fontSize: 12, fontFamily: 'SpaceMono' },
  logCard: { borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  logType: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, fontSize: 10, fontFamily: 'SpaceMono', fontWeight: 'bold' },
  logTime: { fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  logHash: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  logBlock: { fontSize: 14, fontWeight: 'bold' },
  
  expandedContent: { padding: 16, borderTopWidth: 1 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', padding: 8, borderRadius: 8, marginBottom: 6 },
  detailLabel: { fontSize: 11, fontFamily: 'SpaceMono' },
  detailValue: { fontSize: 11, fontFamily: 'SpaceMono', fontWeight: 'bold', maxWidth: '70%' },
  dataHashBox: { padding: 12, borderRadius: 8, borderWidth: 1, marginTop: 8 },
  hashValueFull: { fontSize: 11, fontFamily: 'SpaceMono' },
});
