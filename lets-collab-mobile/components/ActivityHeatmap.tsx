import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, Modal, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { AnimatedPressable } from './AnimatedPressable';
import Animated, { FadeInDown, FadeIn, LinearTransition } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

export function ActivityHeatmap({ sessions = [] }: { sessions?: any[] }) {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';
  
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<any>(null);

  const { heatmapData, monthLabels, startDate, endDate } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    today.setDate(today.getDate() - (weekOffset * 7));
    
    const daysToShow = 84;
    
    const sessionsByDate = sessions.reduce((acc: any, session: any) => {
      if (!session.startedAt) return acc;
      const d = new Date(session.startedAt);
      d.setHours(0, 0, 0, 0);
      const t = d.getTime();
      if (!acc[t]) acc[t] = [];
      acc[t].push(session);
      return acc;
    }, {});

    const days = [];
    for (let i = daysToShow - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const t = d.getTime();
      days.push({
        date: d,
        count: sessionsByDate[t]?.length || 0,
        sessions: sessionsByDate[t] || []
      });
    }

    const weeks = [];
    const labels: { label: string, index: number }[] = [];
    let currentMonth = -1;

    for (let i = 0; i < days.length; i += 7) {
      const week = days.slice(i, i + 7);
      weeks.push(week);
      const month = week[0].date.getMonth();
      if (month !== currentMonth) {
        labels.push({ 
          label: week[0].date.toLocaleString('default', { month: 'short' }), 
          index: weeks.length - 1 
        });
        currentMonth = month;
      }
    }
    
    return { 
      heatmapData: weeks, 
      monthLabels: labels,
      startDate: days[0].date,
      endDate: days[days.length - 1].date
    };
  }, [sessions, weekOffset]);

  const getCellColor = (count: number) => {
    if (count === 0) return isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    if (count < 3) return 'rgba(14, 165, 233, 0.4)';
    if (count < 8) return 'rgba(59, 130, 246, 0.7)';
    if (count < 12) return 'rgba(37, 99, 235, 1)';
    return '#1d4ed8';
  };

  const handleDayPress = (dayData: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDay(dayData);
  };

  const blurTint = isDark ? 'dark' : 'light';

  return (
    <View style={[styles.container, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', borderColor: colors.border }]}>
      
      <View style={styles.header}>
        <AnimatedPressable onPress={() => setWeekOffset(prev => prev + 1)} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={16} color={colors.textDim} />
        </AnimatedPressable>
        
        <Text style={[styles.dateRange, { color: colors.textDim }]}>
          {startDate.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}  –  {endDate.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
        </Text>
        
        <AnimatedPressable onPress={() => setWeekOffset(prev => Math.max(0, prev - 1))} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
        </AnimatedPressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.gridContainer}>
          
          <View style={styles.monthsRow}>
            {monthLabels.map((m, idx) => (
              <Text key={idx} style={[styles.monthLabel, { color: colors.textDim, left: m.index * 18 + 28 }]}>
                {m.label}
              </Text>
            ))}
          </View>

          <View style={styles.mainGrid}>
            <View style={styles.yAxis}>
              <Text style={[styles.axisLabel, { color: colors.textDim }]}>Mon</Text>
              <Text style={[styles.axisLabel, { color: colors.textDim }]}>Wed</Text>
              <Text style={[styles.axisLabel, { color: colors.textDim }]}>Fri</Text>
            </View>
            <View style={styles.weeksContainer}>
              {heatmapData.map((week, wIdx) => (
                <View key={wIdx} style={styles.weekColumn}>
                  {week.map((dayData, dIdx) => (
                    <AnimatedPressable
                      key={dIdx}
                      hapticFeedback="light"
                      onPress={() => handleDayPress(dayData)}
                      style={[
                        styles.cell,
                        { backgroundColor: getCellColor(dayData.count) },
                        isDark && { borderColor: 'rgba(255,255,255,0.05)' }
                      ]}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent={true}
        visible={!!selectedDay}
        onRequestClose={() => setSelectedDay(null)}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={isDark ? 80 : 90} tint={blurTint} style={[styles.modalContent, { borderColor: colors.border, backgroundColor: isDark ? 'rgba(15, 15, 26, 0.9)' : 'rgba(255, 255, 255, 0.95)' }]}>
            {selectedDay && (
              <>
                <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                  <View style={styles.modalTitleRow}>
                    <View style={[styles.detailIcon, { backgroundColor: isDark ? 'rgba(0, 122, 255, 0.2)' : 'rgba(0, 122, 255, 0.1)' }]}>
                      <Ionicons name="star" size={20} color={colors.blue} />
                    </View>
                    <View style={{ marginLeft: 8 }}>
                      <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Activity on {selectedDay.date.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</Text>
                      <Text style={[styles.modalSubtitle, { color: colors.textDim }]}>{selectedDay.count} session{selectedDay.count === 1 ? '' : 's'} recorded.</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedDay(null)} style={styles.closeBtn}>
                    <Ionicons name="close" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                
                <ScrollView style={styles.modalBody} contentContainerStyle={{ paddingBottom: 20 }}>
                    {selectedDay.sessions.map((session: any, index: number) => (
                      <Animated.View 
                        key={index}
                        entering={FadeInDown.delay(index * 100).springify()}
                        layout={LinearTransition.springify()}
                        style={[styles.sessionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      >
                        <View style={styles.sessionHeaderRow}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={[styles.sessionIcon, { backgroundColor: isDark ? 'rgba(110, 63, 255, 0.2)' : 'rgba(110, 63, 255, 0.1)' }]}>
                              <Ionicons name="server" size={16} color={colors.violet} />
                            </View>
                            <Text style={[styles.sessionRoom, { color: colors.textPrimary }]}>{session.roomCode || 'Room'}</Text>
                          </View>
                          <Text style={[styles.sessionTime, { color: colors.textDim }]}>{new Date(session.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                        </View>
                        
                        <View style={styles.sessionHostRow}>
                          <Text style={[styles.hostLabel, { color: colors.textDim }]}>Host</Text>
                          <Text style={[styles.hostName, { color: colors.textSecondary }]}>{session.hostName || 'Unknown'}</Text>
                        </View>

                        <View style={styles.sessionMetricsRow}>
                          <View style={[styles.metricPill, { backgroundColor: isDark ? 'rgba(110, 63, 255, 0.15)' : 'rgba(110, 63, 255, 0.08)', borderColor: isDark ? 'rgba(110, 63, 255, 0.3)' : 'rgba(110, 63, 255, 0.2)' }]}>
                            <View style={[styles.dot, { backgroundColor: colors.violet }]} />
                            <Text style={[styles.metricText, { color: colors.violet }]}>{session.participantCount || 0} Participants</Text>
                          </View>
                        </View>

                        {session.participants && session.participants.length > 0 && (
                          <View style={[styles.rosterSection, { borderTopColor: colors.border }]}>
                            <Text style={[styles.rosterTitle, { color: colors.textDim }]}>ROSTER</Text>
                            {session.participants.map((p: any, idx: number) => (
                              <View key={idx} style={[styles.rosterItem, { borderColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]}>
                                <Text style={[styles.rosterName, { color: colors.textPrimary }]}>{p.name || 'Unknown'}</Text>
                                <Text style={[styles.rosterEmail, { color: colors.textDim }]}>{p.email}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </Animated.View>
                    ))}
                </ScrollView>
              </>
            )}
          </BlurView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, borderRadius: 16, borderWidth: 1, marginTop: 16, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 },
  navBtn: { padding: 4, borderRadius: 6, borderWidth: 1 },
  dateRange: { fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 1, fontWeight: 'bold' },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  gridContainer: { flexDirection: 'column' },
  monthsRow: { height: 16, position: 'relative', marginBottom: 4 },
  monthLabel: { position: 'absolute', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  mainGrid: { flexDirection: 'row', alignItems: 'center' },
  yAxis: { justifyContent: 'space-between', height: 98, marginRight: 8, paddingVertical: 4 },
  axisLabel: { fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  weeksContainer: { flexDirection: 'row', gap: 4 },
  weekColumn: { flexDirection: 'column', gap: 4 },
  cell: { width: 14, height: 14, borderRadius: 3, margin: 2, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 16 },
  modalContent: { width: '100%', maxHeight: '80%', borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, borderBottomWidth: 1 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  modalSubtitle: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 4 },
  closeBtn: { padding: 6, borderRadius: 8 },
  modalBody: { padding: 20 },
  
  sessionCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  sessionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sessionRoom: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: 'bold' },
  sessionTime: { fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  sessionHostRow: { flexDirection: 'row', marginBottom: 8 },
  hostLabel: { fontSize: 12 },
  hostName: { fontSize: 12 },
  sessionMetricsRow: { flexDirection: 'row', gap: 16 },
  metricPill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metricText: { fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  
  rosterSection: { borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  rosterTitle: { fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 1, marginBottom: 8 },
  rosterItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 8, borderRadius: 8, borderWidth: 1, marginBottom: 6 },
  rosterName: { fontSize: 12, fontWeight: '500' },
  rosterEmail: { fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  detailIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sessionIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  }
});
