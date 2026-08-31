import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, ImageBackground, TextInput, TouchableOpacity, Modal, Alert, Platform, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '../../context/ThemeContext';
import { BACKEND_URL, getAuthHeaders } from '../../lib/api';
import { Search, X, CheckCircle, ShieldAlert, Key, Link as LinkIcon, Edit, UserX, Unlock, LogOut, Network, Sun, Moon } from 'lucide-react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../../components/AnimatedPressable';

export default function UsersScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const fetchUsers = async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BACKEND_URL}/api/admin/users`, { headers });
      const data = await res.json();
      if (data.users) {
        setUsers(data.users);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchUsers();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchUsers();
    }, [])
  );

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = users.filter((u) => 
    u.name?.toLowerCase().includes(search.toLowerCase()) || 
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleAction = async (action: string, id: string, payload?: any) => {
    // Optimistic UI updates
    let updatedUsers = [...users];
    
    if (action === 'ban') {
      updatedUsers = users.map(u => u._id === id ? { ...u, banned: !u.banned } : u);
      setUsers(updatedUsers);
      if (selectedUser?._id === id) {
        setSelectedUser({ ...selectedUser, banned: !selectedUser.banned });
      }
    } else if (action === 'role') {
      const newRole = typeof payload === 'string' ? payload : (payload?.role || (selectedUser?.role === 'admin' ? 'user' : 'admin'));
      updatedUsers = users.map(u => u._id === id ? { ...u, role: newRole } : u);
      setUsers(updatedUsers);
      if (selectedUser?._id === id) {
        setSelectedUser({ ...selectedUser, role: newRole });
      }
    }

    try {
      const headers = await getAuthHeaders();
      const options: RequestInit = { method: 'POST', headers };
      
      if (action === 'role') {
        const newRole = typeof payload === 'string' ? payload : (payload?.role || (selectedUser?.role === 'admin' ? 'user' : 'admin'));
        options.headers = { ...headers, 'Content-Type': 'application/json' };
        options.body = JSON.stringify({ role: newRole });
      }
      
      const res = await fetch(`${BACKEND_URL}/api/admin/users/${id}/${action}`, options);
      if (!res.ok) {
        const error = await res.json();
        Alert.alert("Action Failed", error.message || "Could not complete action.");
        fetchUsers(); // revert
      }
    } catch (e) {
      Alert.alert("Network Error", "Could not reach the server.");
      fetchUsers(); // revert
    }
  };

  const isDark = theme === 'dark' || theme === 'glassmorphic';

  const renderItem = ({ item, index }: { item: any, index: number }) => (
      <AnimatedPressable hapticFeedback="light" onPress={() => { setSelectedUser(item); setModalVisible(true); }} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }, item.banned && { borderColor: 'rgba(255, 59, 92, 0.4)' }]}>
        <View style={styles.cardInner}>
          <View style={[styles.avatar, item.banned && { backgroundColor: isDark ? 'rgba(255, 59, 92, 0.1)' : 'rgba(255, 59, 92, 0.05)', borderColor: isDark ? 'rgba(255, 59, 92, 0.3)' : 'rgba(255, 59, 92, 0.15)' }]}>
            <Text style={[styles.avatarText, { color: colors.accent }, item.banned && { color: colors.red }]}>
              {item.name?.charAt(0).toUpperCase() || 'U'}
            </Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.textPrimary }]}>{item.name || 'Unknown User'}</Text>
            <Text style={[styles.userEmail, { color: colors.textDim }]}>{item.email}</Text>
          </View>
          <View style={[styles.badge, item.isVerified ? { backgroundColor: isDark ? 'rgba(0, 196, 140, 0.1)' : 'rgba(0, 196, 140, 0.05)', borderColor: isDark ? 'rgba(0, 196, 140, 0.2)' : 'rgba(0, 196, 140, 0.15)' } : { backgroundColor: isDark ? 'rgba(255, 59, 92, 0.1)' : 'rgba(255, 59, 92, 0.05)', borderColor: isDark ? 'rgba(255, 59, 92, 0.2)' : 'rgba(255, 59, 92, 0.15)' }]}>
            <Text style={[styles.badgeText, item.isVerified ? { color: colors.emerald } : { color: colors.red }]}>
              {item.isVerified ? 'VERIFIED' : 'UNVERIFIED'}
            </Text>
          </View>
        </View>
      </AnimatedPressable>
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
          />
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 50 }} />
        ) : (
          <FlatList
            data={filteredUsers}
            keyExtractor={(item: any) => item._id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContainer}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          />
        )}
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
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
                    <View>
                      <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{selectedUser.name}</Text>
                      <Text style={[styles.modalSubtitle, { color: colors.textDim }]}>{selectedUser.email}</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => setModalVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
                    <X size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.tagsContainer}>
                   <View style={[styles.tag, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
                     <Text style={[styles.tagText, { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }]}>{selectedUser.online ? 'ONLINE' : 'OFFLINE'}</Text>
                   </View>
                   <View style={[styles.tag, selectedUser.isVerified ? { backgroundColor: isDark ? 'rgba(0, 196, 140, 0.15)' : 'rgba(0, 196, 140, 0.1)' } : { backgroundColor: isDark ? 'rgba(240, 165, 0, 0.15)' : 'rgba(240, 165, 0, 0.1)' }]}>
                     <Text style={[styles.tagText, selectedUser.isVerified ? { color: isDark ? colors.emerald : '#009066' } : { color: isDark ? colors.amber : '#b87d00' }]}>{selectedUser.isVerified ? 'VERIFIED' : 'UNVERIFIED'}</Text>
                   </View>
                   <View style={[styles.tag, selectedUser.role === 'admin' ? { backgroundColor: isDark ? 'rgba(110, 63, 255, 0.15)' : 'rgba(110, 63, 255, 0.1)' } : { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
                     <Text style={[styles.tagText, selectedUser.role === 'admin' ? { color: isDark ? colors.violet : '#582ee5' } : { color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }]}>{selectedUser.role.toUpperCase()}</Text>
                   </View>
                </View>
                
                <View style={styles.metricsRow}>
                  <View style={[styles.metricCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.04)', borderWidth: isDark ? 0 : 1 }]}>
                    <Text style={[styles.metricLabel, { color: colors.textDim }]}>SESSIONS</Text>
                    <Text style={[styles.metricValue, { color: isDark ? colors.accent : '#0087a1' }]}>{selectedUser.sessionCount}</Text>
                  </View>
                  <View style={[styles.metricCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff', borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.04)', borderWidth: isDark ? 0 : 1 }]}>
                    <Text style={[styles.metricLabel, { color: colors.textDim }]}>LAST SEEN</Text>
                    <Text style={[styles.metricValue, { color: colors.textPrimary }]}>{selectedUser.lastSeen ? 'Recently' : 'Never'}</Text>
                  </View>
                </View>

                <View style={styles.roleSelectionBox}>
                  <Text style={[styles.metricLabel, { color: colors.textDim }]}>ROLE ASSIGNMENT</Text>
                  <View style={[styles.roleTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)' }]}>
                    <AnimatedPressable 
                      hapticFeedback="light"
                      style={[styles.roleBtn, selectedUser.role === 'user' ? { backgroundColor: isDark ? 'rgba(0, 212, 255, 0.15)' : '#ffffff', shadowColor: '#000', shadowOpacity: isDark ? 0 : 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } } : null]}
                      onPress={() => selectedUser.role !== 'user' && handleAction('role', selectedUser._id, 'user')}
                    >
                      <Text style={[styles.roleBtnText, { color: selectedUser.role === 'user' ? (isDark ? colors.accent : '#0087a1') : colors.textDim }]}>USER</Text>
                    </AnimatedPressable>
                    <AnimatedPressable 
                      hapticFeedback="light"
                      style={[styles.roleBtn, selectedUser.role === 'admin' ? { backgroundColor: isDark ? 'rgba(110, 63, 255, 0.15)' : '#ffffff', shadowColor: '#000', shadowOpacity: isDark ? 0 : 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } } : null]}
                      onPress={() => selectedUser.role !== 'admin' && handleAction('role', selectedUser._id, 'admin')}
                    >
                      <Text style={[styles.roleBtnText, { color: selectedUser.role === 'admin' ? (isDark ? colors.violet : '#582ee5') : colors.textDim }]}>ADMIN</Text>
                    </AnimatedPressable>
                  </View>
                </View>

                <View style={[styles.modalActions, { borderTopColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                  <AnimatedPressable hapticFeedback="light" style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)' }]} onPress={() => setModalVisible(false)}>
                    <Text style={[styles.actionBtnText, { color: isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)' }]}>Close Profile</Text>
                  </AnimatedPressable>
                  <AnimatedPressable 
                    hapticFeedback="medium"
                    style={[styles.actionBtn, { backgroundColor: selectedUser.banned ? (isDark ? 'rgba(0,196,140,0.15)' : '#00a375') : (isDark ? '#e63946' : '#ef4444') }]}
                    onPress={() => handleAction('ban', selectedUser._id, 'ban')}
                  >
                    <Text style={[styles.actionBtnText, { color: '#ffffff' }]}>
                      {selectedUser.banned ? 'Unblock User' : 'Block User'}
                    </Text>
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
  card: { borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  cardInner: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0, 212, 255, 0.1)', borderWidth: 1, borderColor: 'rgba(0, 212, 255, 0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  avatarText: { fontSize: 18, fontWeight: 'bold' },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  userEmail: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: 'bold', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.7)', padding: 16 },
  modalContent: { width: '100%', borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center' },
  modalAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0, 212, 255, 0.1)', borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  modalAvatarText: { fontSize: 24, fontWeight: '900' },
  modalTitle: { fontSize: 22, fontWeight: '900' },
  modalSubtitle: { fontSize: 13, color: 'gray', marginTop: 2 },
  closeBtn: { padding: 8, borderRadius: 8 },
  tagsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, paddingTop: 24 },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  tagText: { fontSize: 11, fontWeight: 'bold' },
  metricsRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 24, paddingTop: 24 },
  metricCard: { flex: 1, borderRadius: 16, padding: 20 },
  metricLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8, opacity: 0.8 },
  metricValue: { fontSize: 24, fontWeight: '900' },
  roleSelectionBox: { padding: 24 },
  roleTrack: { flexDirection: 'row', gap: 4, marginTop: 12, borderRadius: 12, padding: 4 },
  roleBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  roleBtnText: { fontSize: 13, fontWeight: 'bold' },
  modalActions: { flexDirection: 'row', padding: 24, borderTopWidth: 1, gap: 12 },
  actionBtn: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  actionBtnText: { fontSize: 14, fontWeight: 'bold' }
});
