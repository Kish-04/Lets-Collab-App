import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, ImageBackground, TextInput, TouchableOpacity, Modal, Alert, Platform, RefreshControl, AppState, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '../../context/ThemeContext';
import { adminFetch, useAdminReports } from '../../lib/adminData';
import { Search, X, ScanFace, Sun, Moon } from 'lucide-react-native';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { ActivityHeatmap } from '../../components/ActivityHeatmap';

type AppUser = {
  _id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  isVerified: boolean;
  banned: boolean;
  sessionCount: number;
  lastSeen?: string;
  createdAt?: string;
  online: boolean;
};

type Filter = 'all' | 'online' | 'banned' | 'unverified';

const REFRESH_MS = 30000;

function formatRelative(dateStr?: string) {
  if (!dateStr) return 'Never';
  const time = new Date(dateStr).getTime();
  if (Number.isNaN(time)) return '—';
  const diff = Date.now() - time;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Asks before a destructive action (Alert buttons do nothing on react-native-web). */
function confirmAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export default function UsersScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // The selected user is looked up by id so refreshes and actions update the open profile
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const selectedUser = users.find(u => u._id === selectedId) || null;

  // Session history for the per-user activity heatmap comes from the shared, cached report
  const { data: report } = useAdminReports();
  const allSessions: any[] = report?.sessionHistory || [];

  const inFlight = useRef(false);
  const fetchUsers = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await adminFetch<{ users?: AppUser[] }>('/api/admin/users');
      setUsers(Array.isArray(data?.users) ? data.users : []);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load users.');
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchUsers();
  }, [fetchUsers]);

  // Refresh on focus, then every 30 s while this tab is focused and the app is in front
  useFocusEffect(
    useCallback(() => {
      void fetchUsers();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void fetchUsers();
      }, REFRESH_MS);
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') void fetchUsers();
      });
      return () => { clearInterval(timer); sub.remove(); };
    }, [fetchUsers])
  );

  const patchUser = (id: string, patch: Partial<AppUser>) => {
    setUsers(prev => prev.map(u => u._id === id ? { ...u, ...patch } : u));
  };

  const handleBan = async (user: AppUser) => {
    if (busy) return;
    const previous = user.banned;
    setBusy('ban');
    patchUser(user._id, { banned: !previous });
    try {
      const res = await adminFetch<{ banned?: boolean }>(`/api/admin/users/${encodeURIComponent(user._id)}/ban`, { method: 'POST' });
      if (typeof res?.banned !== 'boolean') throw new Error('The server did not confirm the change.');
      patchUser(user._id, { banned: res.banned });
    } catch (e: any) {
      patchUser(user._id, { banned: previous });
      notify(previous ? 'Could not unblock user' : 'Could not block user', e?.message || 'Could not complete the action.');
    } finally {
      setBusy(null);
    }
  };

  const handleRoleChange = async (user: AppUser, role: 'user' | 'admin') => {
    if (busy || user.role === role) return;
    const previous = user.role;
    setBusy('role');
    patchUser(user._id, { role });
    try {
      const res = await adminFetch<{ role?: 'user' | 'admin' }>(`/api/admin/users/${encodeURIComponent(user._id)}/role`, {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      if (res?.role !== role) throw new Error('The server did not confirm the new role.');
    } catch (e: any) {
      patchUser(user._id, { role: previous });
      notify('Could not change role', e?.message || 'Could not complete the action.');
    } finally {
      setBusy(null);
    }
  };

  // Clears a user's Face ID so they can enrol again (they cannot replace it themselves)
  const handleResetFace = async (user: AppUser) => {
    if (busy) return;
    const ok = await confirmAction(
      'Reset Face ID?',
      `${user.name || user.email} will have to set Face ID up again before supervised exams can verify them.`,
      'Reset'
    );
    if (!ok) return;
    setBusy('face');
    try {
      const res = await adminFetch<{ message?: string }>(`/api/face/enrollment/${encodeURIComponent(user._id)}`, { method: 'DELETE' });
      notify('Face ID reset', res?.message || 'The user can enrol again.');
    } catch (e: any) {
      notify('Could not reset Face ID', e?.message || 'Could not reset Face ID.');
    } finally {
      setBusy(null);
    }
  };

  const query = search.trim().toLowerCase();
  const filteredUsers = users.filter(u => {
    const matchSearch = !query || u.name?.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query);
    const matchFilter =
      filter === 'online' ? u.online :
        filter === 'banned' ? u.banned :
          filter === 'unverified' ? !u.isVerified : true;
    return matchSearch && matchFilter;
  });

  const onlineCount = users.filter(u => u.online).length;
  const bannedCount = users.filter(u => u.banned).length;
  const verifiedCount = users.filter(u => u.isVerified).length;
  const adminCount = users.filter(u => u.role === 'admin').length;

  const filterTabs: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: users.length },
    { key: 'online', label: 'Online', count: onlineCount },
    { key: 'banned', label: 'Blocked', count: bannedCount },
    { key: 'unverified', label: 'Unverified', count: users.length - verifiedCount },
  ];

  // Rooms this user hosted or joined, for the activity heatmap
  const userSessions = selectedUser
    ? allSessions.filter((s: any) => s.hostEmail === selectedUser.email || s.participants?.some((p: any) => p?.email === selectedUser.email))
    : [];

  const isDark = theme === 'dark' || theme === 'glassmorphic';

  const renderItem = ({ item }: { item: AppUser }) => (
      <AnimatedPressable hapticFeedback="light" onPress={() => { setSelectedId(item._id); setModalVisible(true); }} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }, item.banned && { borderColor: 'rgba(255, 59, 92, 0.4)', opacity: 0.7 }]}>
        <View style={styles.cardInner}>
          <View>
            <View style={[styles.avatar, item.banned && { backgroundColor: isDark ? 'rgba(255, 59, 92, 0.1)' : 'rgba(255, 59, 92, 0.05)', borderColor: isDark ? 'rgba(255, 59, 92, 0.3)' : 'rgba(255, 59, 92, 0.15)' }]}>
              <Text style={[styles.avatarText, { color: colors.accent }, item.banned && { color: colors.red }]}>
                {item.name?.charAt(0).toUpperCase() || 'U'}
              </Text>
            </View>
            {item.online && <View style={[styles.onlineDot, { backgroundColor: colors.emerald, borderColor: colors.surface }]} />}
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.textPrimary }]} numberOfLines={1}>{item.name || 'Unknown User'}</Text>
            <Text style={[styles.userEmail, { color: colors.textDim }]} numberOfLines={1}>{item.email}</Text>
            <Text style={[styles.userMeta, { color: colors.textDim }]}>{item.role === 'admin' ? 'ADMIN · ' : ''}Last seen {formatRelative(item.lastSeen)}</Text>
          </View>
          <View style={[styles.badge, item.banned ? { backgroundColor: isDark ? 'rgba(255, 59, 92, 0.1)' : 'rgba(255, 59, 92, 0.05)', borderColor: isDark ? 'rgba(255, 59, 92, 0.2)' : 'rgba(255, 59, 92, 0.15)' } : item.isVerified ? { backgroundColor: isDark ? 'rgba(0, 196, 140, 0.1)' : 'rgba(0, 196, 140, 0.05)', borderColor: isDark ? 'rgba(0, 196, 140, 0.2)' : 'rgba(0, 196, 140, 0.15)' } : { backgroundColor: isDark ? 'rgba(240, 165, 0, 0.1)' : 'rgba(240, 165, 0, 0.05)', borderColor: isDark ? 'rgba(240, 165, 0, 0.2)' : 'rgba(240, 165, 0, 0.15)' }]}>
            <Text style={[styles.badgeText, { color: item.banned ? colors.red : item.isVerified ? colors.emerald : colors.amber }]}>
              {item.banned ? 'BLOCKED' : item.isVerified ? 'VERIFIED' : 'UNVERIFIED'}
            </Text>
          </View>
        </View>
      </AnimatedPressable>
  );

  const listHeader = (
    <View>
      <View style={styles.statsGrid}>
        {[
          { label: 'TOTAL', value: users.length, color: colors.textPrimary },
          { label: 'ONLINE', value: onlineCount, color: colors.emerald },
          { label: 'VERIFIED', value: verifiedCount, color: colors.accent },
          { label: 'ADMINS', value: adminCount, color: colors.violet },
        ].map(stat => (
          <View key={stat.label} style={[styles.statCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.statLabel, { color: colors.textDim }]}>{stat.label}</Text>
            <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
          </View>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {filterTabs.map(tab => {
          const active = filter === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setFilter(tab.key)}
              style={[styles.filterChip, active ? { backgroundColor: colors.accent, borderColor: colors.accent } : { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.filterText, { color: active ? '#080810' : colors.textSecondary }]}>{tab.label}</Text>
              <View style={[styles.filterCount, { backgroundColor: active ? 'rgba(0,0,0,0.15)' : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)') }]}>
                <Text style={[styles.filterCountText, { color: active ? '#080810' : colors.textDim }]}>{tab.count}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: isDark ? 'rgba(255, 59, 92, 0.1)' : 'rgba(255, 59, 92, 0.05)', borderColor: isDark ? 'rgba(255, 59, 92, 0.3)' : 'rgba(255, 59, 92, 0.2)' }]}>
          <Text style={[styles.errorText, { color: colors.red }]}>{users.length ? `Showing the last list; refreshing failed: ${error}` : error}</Text>
        </View>
      ) : null}
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
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>User Management</Text>
          <TouchableOpacity onPress={toggleTheme} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {isDark ? <Sun size={16} color={colors.textSecondary} /> : <Moon size={16} color={colors.textSecondary} />}
          </TouchableOpacity>
        </View>

        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Search size={20} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder="Search by name or email..."
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search">
              <X size={16} color={colors.textDim} />
            </TouchableOpacity>
          ) : null}
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 50 }} />
        ) : (
          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => item._id}
            renderItem={renderItem}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
              error && !users.length ? null : (
                <Text style={[styles.emptyText, { color: colors.textDim }]}>
                  {users.length === 0 ? 'No users registered yet' : 'No users match your search'}
                </Text>
              )
            }
            contentContainerStyle={styles.listContainer}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          />
        )}
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible && !!selectedUser}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)', backgroundColor: isDark ? '#1e293b' : '#ffffff' }]}>
            {selectedUser && (
              <>
                <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                  <View style={styles.modalTitleRow}>
                    <View style={[styles.modalAvatar, { borderColor: isDark ? 'rgba(0, 212, 255, 0.3)' : 'rgba(0, 212, 255, 0.15)', shadowColor: colors.accent }, selectedUser.banned && { borderColor: isDark ? 'rgba(255, 59, 92, 0.3)' : 'rgba(255, 59, 92, 0.15)', shadowColor: colors.red }]}>
                      <Text style={[styles.modalAvatarText, { color: colors.accent }, selectedUser.banned && { color: colors.red }]}>
                        {selectedUser.name?.charAt(0).toUpperCase() || 'U'}
                      </Text>
                    </View>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={[styles.modalTitle, { color: colors.textPrimary }]} numberOfLines={1}>{selectedUser.name}</Text>
                      <Text style={[styles.modalSubtitle, { color: colors.textDim }]} numberOfLines={1}>{selectedUser.email}</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => setModalVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
                    <X size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalBody}>
                  <View style={styles.tagsContainer}>
                     <View style={[styles.tag, selectedUser.online ? { backgroundColor: isDark ? 'rgba(0, 196, 140, 0.15)' : 'rgba(0, 196, 140, 0.1)' } : { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
                       <Text style={[styles.tagText, { color: selectedUser.online ? (isDark ? colors.emerald : '#009066') : (isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)') }]}>{selectedUser.online ? 'ONLINE' : 'OFFLINE'}</Text>
                     </View>
                     <View style={[styles.tag, selectedUser.isVerified ? { backgroundColor: isDark ? 'rgba(0, 196, 140, 0.15)' : 'rgba(0, 196, 140, 0.1)' } : { backgroundColor: isDark ? 'rgba(240, 165, 0, 0.15)' : 'rgba(240, 165, 0, 0.1)' }]}>
                       <Text style={[styles.tagText, selectedUser.isVerified ? { color: isDark ? colors.emerald : '#009066' } : { color: isDark ? colors.amber : '#b87d00' }]}>{selectedUser.isVerified ? 'VERIFIED' : 'UNVERIFIED'}</Text>
                     </View>
                     <View style={[styles.tag, selectedUser.role === 'admin' ? { backgroundColor: isDark ? 'rgba(110, 63, 255, 0.15)' : 'rgba(110, 63, 255, 0.1)' } : { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
                       <Text style={[styles.tagText, selectedUser.role === 'admin' ? { color: isDark ? colors.violet : '#582ee5' } : { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }]}>{(selectedUser.role || 'user').toUpperCase()}</Text>
                     </View>
                     {selectedUser.banned && (
                       <View style={[styles.tag, { backgroundColor: isDark ? 'rgba(255, 59, 92, 0.15)' : 'rgba(255, 59, 92, 0.1)' }]}>
                         <Text style={[styles.tagText, { color: colors.red }]}>BLOCKED</Text>
                       </View>
                     )}
                  </View>

                  <View style={styles.metricsRow}>
                    {[
                      { label: 'SESSIONS', value: String(selectedUser.sessionCount ?? 0), color: isDark ? colors.accent : '#0087a1' },
                      { label: 'JOINED', value: formatDate(selectedUser.createdAt), color: colors.textPrimary },
                      { label: 'LAST SEEN', value: formatRelative(selectedUser.lastSeen), color: colors.textPrimary },
                    ].map(metric => (
                      <View key={metric.label} style={[styles.metricCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.04)', borderWidth: isDark ? 0 : 1 }]}>
                        <Text style={[styles.metricLabel, { color: colors.textDim }]}>{metric.label}</Text>
                        <Text style={[styles.metricValue, { color: metric.color }]} numberOfLines={1} adjustsFontSizeToFit>{metric.value}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.heatmapBox}>
                    <Text style={[styles.metricLabel, { color: colors.textDim }]}>ACTIVITY ({userSessions.length} SESSION{userSessions.length === 1 ? '' : 'S'} HOSTED OR JOINED)</Text>
                    <ActivityHeatmap sessions={userSessions} />
                  </View>

                  <View style={styles.roleSelectionBox}>
                    <Text style={[styles.metricLabel, { color: colors.textDim }]}>ROLE ASSIGNMENT</Text>
                    <View style={[styles.roleTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)', opacity: busy === 'role' ? 0.6 : 1 }]}>
                      <AnimatedPressable
                        hapticFeedback="light"
                        disabled={!!busy}
                        style={[styles.roleBtn, selectedUser.role === 'user' ? { backgroundColor: isDark ? 'rgba(0, 212, 255, 0.15)' : '#ffffff', shadowColor: '#000', shadowOpacity: isDark ? 0 : 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } } : null]}
                        onPress={() => void handleRoleChange(selectedUser, 'user')}
                      >
                        <Text style={[styles.roleBtnText, { color: selectedUser.role === 'user' ? (isDark ? colors.accent : '#0087a1') : colors.textDim }]}>USER</Text>
                      </AnimatedPressable>
                      <AnimatedPressable
                        hapticFeedback="light"
                        disabled={!!busy}
                        style={[styles.roleBtn, selectedUser.role === 'admin' ? { backgroundColor: isDark ? 'rgba(110, 63, 255, 0.15)' : '#ffffff', shadowColor: '#000', shadowOpacity: isDark ? 0 : 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } } : null]}
                        onPress={() => void handleRoleChange(selectedUser, 'admin')}
                      >
                        <Text style={[styles.roleBtnText, { color: selectedUser.role === 'admin' ? (isDark ? colors.violet : '#582ee5') : colors.textDim }]}>ADMIN</Text>
                      </AnimatedPressable>
                    </View>
                  </View>

                  <View style={styles.faceBox}>
                    <AnimatedPressable
                      hapticFeedback="medium"
                      disabled={!!busy}
                      style={[styles.faceBtn, { borderColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }]}
                      onPress={() => void handleResetFace(selectedUser)}
                    >
                      {busy === 'face' ? <ActivityIndicator size="small" color={colors.accent} /> : <ScanFace size={16} color={colors.accent} />}
                      <Text style={[styles.faceBtnText, { color: colors.accent }]}>Reset Face ID</Text>
                    </AnimatedPressable>
                  </View>
                </ScrollView>

                <View style={[styles.modalActions, { borderTopColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                  <AnimatedPressable hapticFeedback="light" style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)' }]} onPress={() => setModalVisible(false)}>
                    <Text style={[styles.actionBtnText, { color: isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)' }]}>Close Profile</Text>
                  </AnimatedPressable>
                  <AnimatedPressable
                    hapticFeedback="medium"
                    disabled={!!busy}
                    style={[styles.actionBtn, { backgroundColor: selectedUser.banned ? (isDark ? 'rgba(0,196,140,0.15)' : '#00a375') : (isDark ? '#e63946' : '#ef4444'), opacity: busy === 'ban' ? 0.6 : 1 }]}
                    onPress={() => void handleBan(selectedUser)}
                  >
                    {busy === 'ban' ? <ActivityIndicator size="small" color="#ffffff" /> : (
                      <Text style={[styles.actionBtnText, { color: '#ffffff' }]}>
                        {selectedUser.banned ? 'Unblock User' : 'Block User'}
                      </Text>
                    )}
                  </AnimatedPressable>
                </View>
              </>
            )}
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
  content: { flex: 1, padding: 16, zIndex: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 40, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  iconBtn: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  searchBox: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  searchInput: { flex: 1, height: 48, fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  listContainer: { paddingBottom: 100, gap: 12 },
  statsGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  statLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  statValue: { fontSize: 20, fontWeight: '900', marginTop: 4 },
  filterRow: { gap: 8, paddingBottom: 4, paddingRight: 16 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  filterText: { fontSize: 12, fontWeight: '700' },
  filterCount: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999 },
  filterCountText: { fontSize: 10, fontWeight: '700' },
  errorBox: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  errorText: { fontSize: 12, fontWeight: '600' },
  emptyText: { textAlign: 'center', marginTop: 40, fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  card: { borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  cardInner: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0, 212, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(0, 212, 255, 0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  avatarText: { fontSize: 18, fontWeight: 'bold' },
  onlineDot: { position: 'absolute', right: 14, bottom: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  userInfo: { flex: 1, marginRight: 8 },
  userName: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  userEmail: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  userMeta: { fontSize: 10, marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: 'bold', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.7)', padding: 16 },
  modalContent: { width: '100%', maxHeight: '90%', borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  modalAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0, 212, 255, 0.1)', borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  modalAvatarText: { fontSize: 24, fontWeight: '900' },
  modalTitle: { fontSize: 22, fontWeight: '900' },
  modalSubtitle: { fontSize: 13, color: 'gray', marginTop: 2 },
  closeBtn: { padding: 8, borderRadius: 8 },
  modalBody: { flexGrow: 0 },
  tagsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, paddingTop: 24 },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  tagText: { fontSize: 11, fontWeight: 'bold' },
  metricsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 24, paddingTop: 24 },
  metricCard: { flex: 1, borderRadius: 16, padding: 14 },
  metricLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8, opacity: 0.8 },
  metricValue: { fontSize: 16, fontWeight: '900' },
  heatmapBox: { paddingHorizontal: 24, paddingTop: 24 },
  roleSelectionBox: { padding: 24, paddingBottom: 12 },
  roleTrack: { flexDirection: 'row', gap: 4, marginTop: 12, borderRadius: 12, padding: 4 },
  roleBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  roleBtnText: { fontSize: 13, fontWeight: 'bold' },
  faceBox: { paddingHorizontal: 24, paddingBottom: 24 },
  faceBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1 },
  faceBtnText: { fontSize: 13, fontWeight: 'bold' },
  modalActions: { flexDirection: 'row', padding: 24, borderTopWidth: 1, gap: 12 },
  actionBtn: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  actionBtnText: { fontSize: 14, fontWeight: 'bold' }
});
