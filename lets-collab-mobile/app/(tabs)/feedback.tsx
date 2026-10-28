// What visitors sent from the website's "Help us improve" form.
// Mobile counterpart of the web's app/admin/feedback/page.tsx.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, ImageBackground, TouchableOpacity, Platform, RefreshControl, Linking, Alert } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { adminFetch } from '../../lib/adminData';
import { MessageSquareHeart, Sun, Moon, RefreshCw, Mail, Star, AlertTriangle, Inbox } from 'lucide-react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { AnimatedPressable } from '../../components/AnimatedPressable';

type Status = 'new' | 'read' | 'planned' | 'done';

type FeedbackItem = {
  _id: string;
  name: string;
  email: string;
  role: string;
  rating?: number;
  problem: string;
  improvement?: string;
  contactOk: boolean;
  userId?: string;
  status: Status;
  createdAt?: string;
};

type FeedbackResponse = { success: boolean; items: FeedbackItem[]; averageRating: number | null };

const STATUSES: Status[] = ['new', 'read', 'planned', 'done'];

function when(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export default function FeedbackScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark' || theme === 'glassmorphic';
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [averageRating, setAverageRating] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const statusColor: Record<Status, string> = {
    new: colors.accent,
    read: colors.textSecondary,
    planned: colors.amber,
    done: colors.emerald,
  };

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await adminFetch<FeedbackResponse>('/api/feedback');
      setItems(Array.isArray(data?.items) ? data.items : []);
      setAverageRating(data?.averageRating ?? null);
      setLoaded(true);
    } catch (err: any) {
      setError(err?.message || 'Could not load feedback.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const setStatus = async (item: FeedbackItem, status: Status) => {
    if (item.status === status) return;
    setItems(prev => prev.map(entry => entry._id === item._id ? { ...entry, status } : entry));
    try {
      await adminFetch(`/api/feedback/${encodeURIComponent(item._id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch (err: any) {
      setItems(prev => prev.map(entry => entry._id === item._id ? item : entry));
      Alert.alert('Feedback', err?.message || 'Could not update the status.');
    }
  };

  const reply = async (item: FeedbackItem) => {
    try {
      await Linking.openURL(`mailto:${item.email}?subject=${encodeURIComponent("Your Let's Collab feedback")}`);
    } catch {
      Alert.alert('Email', `No mail app could be opened. The address is ${item.email}.`);
    }
  };

  const shown = useMemo(() => (filter === 'all' ? items : items.filter(item => item.status === filter)), [items, filter]);
  const unread = items.filter(item => item.status === 'new').length;

  const renderItem = ({ item }: { item: FeedbackItem }) => (
    <Animated.View layout={LinearTransition} style={{ marginBottom: 12 }}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: item.status === 'new' ? colors.accent : colors.border }]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: colors.textPrimary }]}>
              {item.name}
              <Text style={{ color: colors.textDim, fontFamily: 'Inter_500Medium' }}> · {item.role}{item.userId ? ' · signed in' : ''}</Text>
            </Text>
            <Text style={[styles.meta, { color: colors.textDim }]}>{item.email}{item.contactOk ? '' : ' (no contact)'}{item.createdAt ? ` · ${when(item.createdAt)}` : ''}</Text>
          </View>
          {item.rating ? (
            <View style={styles.stars} accessibilityLabel={`${item.rating} out of 5`}>
              {[1, 2, 3, 4, 5].map(value => (
                <Star key={value} size={12} color={value <= item.rating! ? colors.amber : colors.textDim} fill={value <= item.rating! ? colors.amber : 'transparent'} />
              ))}
            </View>
          ) : null}
        </View>

        <Text style={[styles.label, { color: colors.textDim }]}>PROBLEM</Text>
        <Text style={[styles.body, { color: colors.textPrimary }]}>{item.problem}</Text>
        {item.improvement ? (
          <>
            <Text style={[styles.label, { color: colors.textDim }]}>HOW WE CAN IMPROVE</Text>
            <Text style={[styles.body, { color: colors.textPrimary }]}>{item.improvement}</Text>
          </>
        ) : null}

        <View style={styles.statusRow}>
          {STATUSES.map(status => {
            const active = item.status === status;
            return (
              <AnimatedPressable
                key={status}
                hapticFeedback="light"
                onPress={() => void setStatus(item, status)}
                style={[styles.statusPill, { borderColor: active ? statusColor[status] : colors.border, backgroundColor: active ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') : 'transparent' }]}
              >
                <Text style={[styles.statusText, { color: active ? statusColor[status] : colors.textDim }]}>{status.toUpperCase()}</Text>
              </AnimatedPressable>
            );
          })}
        </View>

        {item.contactOk ? (
          <TouchableOpacity onPress={() => void reply(item)} style={[styles.replyBtn, { borderColor: colors.border }]}>
            <Mail size={12} color={colors.accent} />
            <Text style={[styles.replyText, { color: colors.accent }]}>Reply by email</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Animated.View>
  );

  const ListEmpty = () => {
    if (error && !loaded) {
      return (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconBox, { backgroundColor: isDark ? 'rgba(255,59,92,0.1)' : 'rgba(255,59,92,0.05)', borderColor: isDark ? 'rgba(255,59,92,0.3)' : 'rgba(255,59,92,0.15)' }]}>
            <AlertTriangle size={40} color={colors.red} />
          </View>
          <Text style={[styles.emptyText, { color: colors.textPrimary }]}>Feedback could not be loaded</Text>
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
        <Text style={[styles.emptyText, { color: colors.textPrimary }]}>No feedback here yet</Text>
        <Text style={[styles.emptySubtext, { color: colors.textDim }]}>Responses from the website&apos;s &quot;Help us improve&quot; form appear here.</Text>
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
          <MessageSquareHeart size={20} color={colors.accent} />
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Feedback</Text>
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
          data={shown}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={ListEmpty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListHeaderComponent={
            <View style={styles.headerContent}>
              {loaded ? (
                <Text style={[styles.summary, { color: colors.textSecondary }]}>
                  {items.length} response(s), {unread} new{averageRating ? ` · average rating ${averageRating} / 5` : ''}.
                </Text>
              ) : null}
              <View style={styles.filterRow}>
                {(['all', ...STATUSES] as const).map(value => (
                  <TouchableOpacity key={value} onPress={() => setFilter(value)}
                    style={[styles.filterPill, { borderColor: filter === value ? colors.accent : colors.border }]}>
                    <Text style={[styles.statusText, { color: filter === value ? colors.accent : colors.textSecondary }]}>{value.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
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
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  filterPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1 },

  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  bannerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium' },

  card: { borderRadius: 12, borderWidth: 1, marginHorizontal: 16, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  name: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  meta: { fontSize: 10, fontFamily: 'SpaceMono' },
  stars: { flexDirection: 'row', gap: 2, marginTop: 2 },

  label: { fontSize: 10, fontFamily: 'SpaceMono', letterSpacing: 1, marginTop: 14, marginBottom: 4 },
  body: { fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 19 },

  statusRow: { flexDirection: 'row', gap: 6, marginTop: 14 },
  statusPill: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 6, borderWidth: 1 },
  statusText: { fontSize: 10, fontFamily: 'SpaceMono', fontWeight: 'bold', letterSpacing: 1 },
  replyBtn: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, marginTop: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  replyText: { fontSize: 11, fontFamily: 'SpaceMono', fontWeight: 'bold' },

  emptyContainer: { padding: 40, alignItems: 'center', marginTop: 10 },
  emptyIconBox: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1 },
  emptyText: { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  emptySubtext: { fontSize: 14, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  retryText: { fontSize: 11, fontFamily: 'SpaceMono', fontWeight: 'bold' },
});
