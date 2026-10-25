// Human review of proctoring alerts: uphold or dismiss each flag, and answer student appeals.
// Mobile counterpart of the web's app/admin/review/page.tsx. Dismissing a flag (or accepting an
// appeal) also teaches the on-device model that it was a false positive.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, ImageBackground, TouchableOpacity, Platform, TextInput, RefreshControl, Linking, Alert } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { BACKEND_URL } from '../../lib/api';
import { adminFetch } from '../../lib/adminData';
import { Scale, Sun, Moon, RefreshCw, CheckCircle, XCircle, MessageSquareWarning, AlertTriangle, ExternalLink, Inbox } from 'lucide-react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../../components/AnimatedPressable';

type QueueItem = {
  _id: string;
  room: string;
  event?: string;
  message: string;
  penalty: number;
  evidenceUrl?: string | null;
  createdAt?: string;
  candidate: string | null;
  reviewStatus: string;
  appeal: { text: string; createdAt: string; status: string } | null;
};

type QueueResponse = { success: boolean; alerts: QueueItem[] };

function when(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// Evidence URLs from the server are signed, short-lived /uploads paths
const evidenceUri = (url: string) => (url.startsWith('http') ? url : `${BACKEND_URL}${url}`);

export default function ReviewQueueScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark' || theme === 'glassmorphic';
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await adminFetch<QueueResponse>('/api/reviews/queue');
      setItems(Array.isArray(data?.alerts) ? data.alerts : []);
      setLoaded(true);
    } catch (err: any) {
      setError(err?.message || 'Could not load the review queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const setItemError = (id: string, message: string) =>
    setItemErrors(prev => {
      const next = { ...prev };
      if (message) next[id] = message; else delete next[id];
      return next;
    });

  const decide = async (item: QueueItem, path: 'decision' | 'appeal-decision', decision: 'dismissed' | 'upheld' | 'accepted' | 'rejected') => {
    const text = (drafts[item._id] || '').trim();
    if (path === 'appeal-decision' && !text) {
      setItemError(item._id, 'Write a response the student will see before deciding the appeal.');
      return;
    }
    setBusy(item._id);
    setItemError(item._id, '');
    try {
      const body = path === 'decision' ? { decision, note: text } : { decision, response: text };
      await adminFetch(`/api/reviews/${encodeURIComponent(item._id)}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Decided items leave the queue
      setItems(prev => prev.filter(entry => entry._id !== item._id));
      setDrafts(prev => {
        const next = { ...prev };
        delete next[item._id];
        return next;
      });
    } catch (err: any) {
      setItemError(item._id, err?.message || 'Could not save the decision.');
    } finally {
      setBusy(null);
    }
  };

  const openEvidence = async (url: string) => {
    try {
      await Linking.openURL(evidenceUri(url));
    } catch {
      Alert.alert('Evidence', 'The evidence could not be opened. Pull to refresh for a new link.');
    }
  };

  const appeals = items.filter(item => item.appeal?.status === 'open').length;

  const renderItem = ({ item }: { item: QueueItem }) => {
    const appealOpen = item.appeal?.status === 'open';
    const saving = busy === item._id;
    const disabled = busy !== null;
    const itemError = itemErrors[item._id];
    return (
      <Animated.View layout={LinearTransition} exiting={FadeOut} style={{ marginBottom: 12 }}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: appealOpen ? (isDark ? 'rgba(240,165,0,0.5)' : 'rgba(240,165,0,0.4)') : colors.border }]}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.message, { color: colors.textPrimary }]}>{item.message || 'Alert'}</Text>
              <Text style={[styles.meta, { color: colors.textDim }]}>
                {item.candidate || 'unknown candidate'} · room {item.room} · {item.event || 'alert'}{item.createdAt ? ` · ${when(item.createdAt)}` : ''}
              </Text>
            </View>
            <View style={[styles.riskPill, { backgroundColor: isDark ? 'rgba(255,59,92,0.15)' : 'rgba(255,59,92,0.08)' }]}>
              <Text style={[styles.riskPillText, { color: colors.red }]}>+{item.penalty} risk</Text>
            </View>
          </View>

          {item.evidenceUrl ? (
            <TouchableOpacity onPress={() => openEvidence(item.evidenceUrl!)} style={[styles.evidenceBtn, { borderColor: colors.border }]}>
              <ExternalLink size={12} color={colors.accent} />
              <Text style={[styles.evidenceText, { color: colors.accent }]}>Evidence</Text>
            </TouchableOpacity>
          ) : null}

          {appealOpen && item.appeal ? (
            <View style={[styles.appealBox, { borderColor: isDark ? 'rgba(240,165,0,0.4)' : 'rgba(240,165,0,0.3)', backgroundColor: isDark ? 'rgba(240,165,0,0.1)' : 'rgba(240,165,0,0.05)' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MessageSquareWarning size={14} color={colors.amber} />
                <Text style={[styles.appealLabel, { color: colors.amber }]}>APPEAL{item.appeal.createdAt ? ` · ${when(item.appeal.createdAt)}` : ''}</Text>
              </View>
              <Text style={[styles.appealText, { color: colors.textPrimary }]}>{item.appeal.text}</Text>
            </View>
          ) : null}

          <Text style={[styles.label, { color: colors.textDim }]}>
            {appealOpen ? 'RESPONSE TO THE STUDENT (REQUIRED)' : 'NOTE (OPTIONAL, THE STUDENT CAN SEE IT)'}
          </Text>
          <TextInput
            value={drafts[item._id] || ''}
            onChangeText={value => setDrafts(prev => ({ ...prev, [item._id]: value }))}
            editable={!saving}
            multiline
            maxLength={1000}
            placeholder={appealOpen ? 'Explain your decision…' : 'Optional note…'}
            placeholderTextColor={colors.textDim}
            style={[styles.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.5)' }]}
          />

          {itemError ? <Text style={[styles.itemError, { color: colors.red }]}>{itemError}</Text> : null}

          <View style={styles.actions}>
            <AnimatedPressable
              hapticFeedback="medium"
              disabled={disabled}
              onPress={() => void decide(item, appealOpen ? 'appeal-decision' : 'decision', appealOpen ? 'accepted' : 'dismissed')}
              style={[styles.actionBtn, { backgroundColor: colors.emerald, borderColor: colors.emerald }, disabled && styles.disabled]}
            >
              {saving ? <ActivityIndicator size="small" color="#000" /> : <CheckCircle size={14} color="#000" />}
              <Text style={[styles.actionText, { color: '#000' }]}>{appealOpen ? 'Accept appeal' : 'Dismiss (false positive)'}</Text>
            </AnimatedPressable>
            <AnimatedPressable
              hapticFeedback="medium"
              disabled={disabled}
              onPress={() => void decide(item, appealOpen ? 'appeal-decision' : 'decision', appealOpen ? 'rejected' : 'upheld')}
              style={[styles.actionBtn, { borderColor: isDark ? 'rgba(255,59,92,0.5)' : 'rgba(255,59,92,0.4)' }, disabled && styles.disabled]}
            >
              <XCircle size={14} color={colors.red} />
              <Text style={[styles.actionText, { color: colors.red }]}>{appealOpen ? 'Reject appeal' : 'Uphold flag'}</Text>
            </AnimatedPressable>
          </View>
          {appealOpen ? (
            <Text style={[styles.hint, { color: colors.textDim }]}>Accepting dismisses the flag; rejecting keeps it.</Text>
          ) : null}
        </View>
      </Animated.View>
    );
  };

  const ListEmpty = () => {
    if (error && !loaded) {
      return (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconBox, { backgroundColor: isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)', borderColor: isDark ? 'rgba(255,59,92,0.3)' : 'rgba(255,59,92,0.15)' }]}>
            <AlertTriangle size={40} color={colors.red} />
          </View>
          <Text style={[styles.emptyText, { color: colors.textPrimary }]}>Queue could not be loaded</Text>
          <Text style={[styles.emptySubtext, { color: colors.textDim }]}>{error}</Text>
          <TouchableOpacity onPress={onRefresh} style={[styles.retryBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <RefreshCw size={14} color={colors.textPrimary} />
            <Text style={[styles.retryText, { color: colors.textPrimary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyIconBox, { backgroundColor: isDark ? 'rgba(0, 196, 140, 0.1)' : 'rgba(0, 196, 140, 0.05)', borderColor: isDark ? 'rgba(0, 196, 140, 0.3)' : 'rgba(0, 196, 140, 0.1)' }]}>
          <Inbox size={40} color={colors.emerald} />
        </View>
        <Text style={[styles.emptyText, { color: colors.textPrimary }]}>Nothing to review</Text>
        <Text style={[styles.emptySubtext, { color: colors.textDim }]}>Flags that cost a candidate points and open appeals appear here.</Text>
      </View>
    );
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Scale size={20} color={colors.accent} />
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Review Queue</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={onRefresh} disabled={refreshing} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <RefreshCw size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleTheme} style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {isDark ? <Sun size={16} color={colors.textSecondary} /> : <Moon size={16} color={colors.textSecondary} />}
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={ListEmpty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListHeaderComponent={
            <View style={styles.headerContent}>
              {loaded ? (
                <Text style={[styles.summary, { color: colors.textSecondary }]}>
                  {items.length} flag(s) waiting, {appeals} with an open appeal. Dismissing a flag also trains the model that it was a false positive.
                </Text>
              ) : null}
              {error && loaded ? (
                <Animated.View entering={FadeInDown} style={[styles.banner, { borderColor: isDark ? 'rgba(255,59,92,0.4)' : 'rgba(255,59,92,0.3)', backgroundColor: isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)' }]}>
                  <AlertTriangle size={16} color={colors.red} />
                  <Text style={[styles.bannerText, { color: colors.red }]}>Refresh failed: {error}</Text>
                </Animated.View>
              ) : null}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  baseBg: { ...StyleSheet.absoluteFill },
  gridBg: { ...StyleSheet.absoluteFill },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 40, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)', zIndex: 20 },
  iconBtn: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  headerContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  listContainer: { paddingBottom: 100 },
  summary: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 12, lineHeight: 18 },

  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  bannerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium' },

  card: { borderRadius: 12, borderWidth: 1, marginHorizontal: 16, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  message: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  meta: { fontSize: 10, fontFamily: 'SpaceMono' },
  riskPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  riskPillText: { fontSize: 10, fontFamily: 'SpaceMono', fontWeight: 'bold' },
  evidenceBtn: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  evidenceText: { fontSize: 11, fontFamily: 'SpaceMono', fontWeight: 'bold' },

  appealBox: { marginTop: 12, padding: 12, borderRadius: 8, borderWidth: 1 },
  appealLabel: { fontSize: 10, fontFamily: 'SpaceMono', fontWeight: 'bold', letterSpacing: 1 },
  appealText: { fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 6 },

  label: { fontSize: 10, fontFamily: 'SpaceMono', letterSpacing: 1, marginTop: 14, marginBottom: 6 },
  input: { minHeight: 64, borderRadius: 8, borderWidth: 1, padding: 10, fontSize: 13, fontFamily: 'SpaceMono', textAlignVertical: 'top' },
  itemError: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 8 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1 },
  actionText: { fontSize: 11, fontFamily: 'SpaceMono', fontWeight: 'bold', flexShrink: 1 },
  disabled: { opacity: 0.5 },
  hint: { fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 8 },

  emptyContainer: { padding: 40, alignItems: 'center', marginTop: 10 },
  emptyIconBox: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1 },
  emptyText: { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  emptySubtext: { fontSize: 14, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  retryText: { fontSize: 11, fontFamily: 'SpaceMono', fontWeight: 'bold' },
});
