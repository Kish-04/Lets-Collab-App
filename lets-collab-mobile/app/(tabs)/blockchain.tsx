import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, ImageBackground, Platform, Linking } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useAdminSocket, useOnAdminConnect, useSocketEvent } from '../../lib/adminData';
import { RefreshCw, Link as LinkIcon, Wifi, WifiOff, Sun, Moon } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { AuditIntegrity } from '../../components/AuditIntegrity';

type ChainData = {
  active: boolean;
  logs: any[];
  totalCount: number;
  contractAddress: string | null;
  currentBlock?: number;
  error?: string;
  chain?: { chainId: number; name: string; explorer: string | null; explorerTxBaseUrl: string | null };
};

// A sync with no answer stops spinning after this long
const SYNC_TIMEOUT_MS = 20000;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export default function BlockchainScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark' || theme === 'glassmorphic';
  
  const { socket, status: socketStatus, statusDetail } = useAdminSocket();
  const [chainData, setChainData] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [lastSynced, setLastSynced] = useState<string>("");
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopSyncing = () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = null;
    setSyncing(false);
  };
  useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current); }, []);

  // Ask for the chain on the shared admin connection (again after every reconnect)
  useOnAdminConnect(next => next.emit('query-chain'));

  useSocketEvent<ChainData>('chain-data', (data) => {
    setChainData(data);
    setLoading(false);
    stopSyncing();
    setLastSynced(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  });

  // A new audit transaction from host activity: fetch the chain again
  useSocketEvent('chain-log', () => socket?.emit('query-chain'));

  // Not allowed or the query failed: say so instead of loading forever. Tabs stay mounted and the
  // connection is shared, so only an error while a chain query is pending belongs to this screen.
  useSocketEvent<string>('admin-error', (message) => {
    if (!loading && !syncing) return;
    setChainData(prev => ({ ...(prev || { active: false, logs: [], totalCount: 0, contractAddress: null }), error: String(message) }));
    setLoading(false);
    stopSyncing();
  });

  // The connection itself failed before any chain data arrived
  useEffect(() => {
    if (socketStatus === 'error' || socketStatus === 'signed-out') {
      setLoading(false);
      stopSyncing();
    }
  }, [socketStatus]);

  const handleSync = () => {
    if (syncing) return;
    if (!socket || socketStatus !== 'connected') {
      setChainData(prev => ({ ...(prev || { active: false, logs: [], totalCount: 0, contractAddress: null }), error: 'Not connected to the server yet; try again in a moment.' }));
      return;
    }
    setSyncing(true);
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      syncTimer.current = null;
      setSyncing(false);
      setChainData(prev => ({ ...(prev || { active: false, logs: [], totalCount: 0, contractAddress: null }), error: 'The server did not answer the sync request in time.' }));
    }, SYNC_TIMEOUT_MS);
    // Clear the last error; a fresh answer replaces the whole object anyway
    setChainData(prev => prev ? { ...prev, error: undefined } : prev);
    socket.emit('query-chain');
  };

  const logs = chainData?.logs || [];
  const allEventTypes: string[] = Array.from(new Set<string>(logs.map((l: any) => String(l.eventType))));
  const filtered = filterType === "all" ? logs : logs.filter((l: any) => l.eventType === filterType);

  // Event names the server writes (server/index.js anchorEvent)
  const getEventStyle = (type: string) => {
    switch (type) {
      case 'ROOM_CREATED':
      case 'SESSION_ARCHIVED': return { bg: 'rgba(0,196,140,0.2)', text: colors.emerald, border: 'rgba(0,196,140,0.3)' };
      case 'USER_JOINED':
      case 'USER_LEFT': return { bg: 'rgba(110,63,255,0.2)', text: colors.violet, border: 'rgba(110,63,255,0.3)' };
      case 'ACCESS_REVOKED':
      case 'FEDERATED_AGGREGATE': return { bg: 'rgba(0,212,255,0.2)', text: colors.accent, border: 'rgba(0,212,255,0.3)' };
      case 'SESSION_TERMINATED':
      case 'IDENTITY_MISMATCH':
      case 'EVIDENCE_PURGED': return { bg: 'rgba(255,59,92,0.2)', text: colors.red, border: 'rgba(255,59,92,0.3)' };
      case 'AI_ANTI_CHEAT_ALERT':
      case 'ADMIN_WARNING': return { bg: 'rgba(240,165,0,0.2)', text: colors.amber, border: 'rgba(240,165,0,0.3)' };
      default: return { bg: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)', text: colors.textPrimary, border: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)' };
    }
  };
  const truncateHash = (hash?: string | null) => hash ? `${hash.slice(0, 8)}...${hash.slice(-6)}` : '—';
  const chain = chainData?.chain;
  const contractUrl = chainData?.contractAddress && chain?.explorer ? `${chain.explorer.replace(/\/$/, '')}/address/${chainData.contractAddress}` : null;

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
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
            <View style={[styles.networkBadge, { backgroundColor: 'rgba(110,63,255,0.2)', borderColor: 'rgba(110,63,255,0.4)' }]}>
              <Text style={[styles.networkText, { color: colors.violet }]}>{chain?.name ? chain.name.toUpperCase() : loading ? '…' : 'NO CHAIN'}</Text>
            </View>
            {chainData && (
              <View style={styles.metricCard}>
                <View style={[styles.metricIcon, { backgroundColor: chainData.active ? 'rgba(0,196,140,0.1)' : 'rgba(240,165,0,0.1)' }]}>
                  {chainData.active ? <Wifi size={14} color={colors.emerald} /> : <WifiOff size={14} color={colors.amber} />}
                </View>
                <Text style={[styles.statusText, { color: chainData.active ? colors.emerald : colors.amber }]}>
                  {chainData.active ? 'CONNECTED' : 'OFF-CHAIN'}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.syncedText, { color: colors.textDim }]}>
            {lastSynced ? `Last synced ${lastSynced}` : socketStatus === 'connected' ? 'Querying the audit chain…' : 'Connecting…'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity 
            onPress={handleSync}
            disabled={syncing}
            accessibilityLabel="Sync with the audit chain" 
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

        <View style={[styles.contractCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.statLabel, { color: colors.textDim }]}>CONTRACT ADDRESS</Text>
          {loading ? (
            <Text style={[styles.hashValueFull, { color: colors.textDim }]}>Loading…</Text>
          ) : chainData?.contractAddress ? (
            <>
              <Text style={[styles.hashValueFull, { color: colors.textPrimary }]} selectable>{chainData.contractAddress}</Text>
              {contractUrl && (
                <TouchableOpacity onPress={() => void Linking.openURL(contractUrl)} style={styles.linkRow}>
                  <Text style={[styles.detailLabel, { color: colors.accent }]}>View contract on block explorer</Text>
                  <LinkIcon size={12} color={colors.accent} />
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={[styles.hashValueFull, { color: colors.amber }]}>Not deployed</Text>
          )}
        </View>

        {!loading && chainData && !chainData.active && (
          <View style={[styles.noticeBox, { borderColor: 'rgba(240,165,0,0.4)', backgroundColor: 'rgba(240,165,0,0.1)' }]}>
            <Text style={[styles.noticeText, { color: colors.amber }]}>
              The audit chain is not reachable from the server. New events are kept off-chain until it is, and no on-chain history can be shown.
            </Text>
          </View>
        )}

        {chainData?.error ? (
          <View style={[styles.noticeBox, { borderColor: 'rgba(255,59,92,0.4)', backgroundColor: 'rgba(255,59,92,0.1)' }]}>
            <Text style={[styles.noticeText, { color: colors.red }]}>Error: {chainData.error}</Text>
          </View>
        ) : null}

        {!chainData && !loading && (socketStatus === 'error' || socketStatus === 'signed-out') && (
          <View style={[styles.noticeBox, { borderColor: 'rgba(255,59,92,0.4)', backgroundColor: 'rgba(255,59,92,0.1)' }]}>
            <Text style={[styles.noticeText, { color: colors.red }]}>
              {socketStatus === 'signed-out' ? 'You are signed out.' : `Could not reach the server${statusDetail ? `: ${statusDetail}` : '.'}`}
            </Text>
          </View>
        )}

        {logs.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll} style={styles.filters}>
            {['all', ...allEventTypes].map((type) => (
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
        ) : filtered.length === 0 ? (
          <Text style={[styles.footerText, { color: colors.textDim }]}>
            {chainData?.active ? 'No audit events recorded on the chain yet.' : 'No on-chain audit events to show.'}
          </Text>
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
                      <Text style={[styles.detailValue, { color: colors.textPrimary }]}>{log.timestamp ? new Date(log.timestamp * 1000).toLocaleString() : '—'}</Text>
                    </View>
                    <View style={[styles.dataHashBox, { borderColor: colors.border }]}>
                      <Text style={[styles.detailLabel, { color: colors.textDim }]}>Data hash</Text>
                      <Text style={[styles.hashValueFull, { color: colors.textSecondary }]} selectable>{log.dataHash}</Text>
                    </View>
                    {chain?.explorerTxBaseUrl && typeof log.txHash === 'string' && TX_HASH.test(log.txHash) && (
                      <TouchableOpacity onPress={() => void Linking.openURL(`${chain.explorerTxBaseUrl}${log.txHash}`)} style={[styles.detailRow, { marginTop: 8 }]}>
                        <Text style={[styles.detailLabel, { color: colors.accent }]}>View on block explorer</Text>
                        <LinkIcon size={12} color={colors.accent} />
                      </TouchableOpacity>
                    )}
                    <View style={{ marginTop: 8 }}>
                      <AuditIntegrity sessionId={log.sessionId} />
                    </View>
                  </View>
                )}
              </Animated.View>
            );
          })
        )}

        <Text style={[styles.footerText, { color: colors.textDim }]}>
          {chainData?.active
            ? 'Session events are hashed with keccak256 and written to the audit contract; a written entry cannot be changed.'
            : 'Not connected to the audit chain: events are not being written on-chain right now.'}
        </Text>
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
  syncedText: { fontSize: 10, fontFamily: 'SpaceMono', marginTop: 6 },
  contractCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 6 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  noticeBox: { borderRadius: 12, borderWidth: 1, padding: 12 },
  noticeText: { fontSize: 12, fontFamily: 'SpaceMono' },
  footerText: { fontSize: 10, fontFamily: 'SpaceMono', textAlign: 'center', marginTop: 12, paddingHorizontal: 8 },
});
