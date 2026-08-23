import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity, Modal, ScrollView, Alert as RNAlert, Image } from 'react-native';
import { useApi } from '../context/ApiContext';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export default function ActivityScreen() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const { client } = useApi();
  const { theme } = useTheme();

  const fetchReports = async () => {
    try {
      const res = await client.get('/reports');
      if (res.data.success) {
        setAlerts(res.data.alerts);
      }
    } catch (err) {
      console.error('Failed to fetch alerts', err);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchReports();
    setRefreshing(false);
  };

  const updateAlertStatus = async (id: string, updates: { flagged?: boolean, falsePositive?: boolean }) => {
    try {
      const res = await client.post(`/alerts/${id}/status`, updates);
      if (res.data.success) {
        setAlerts(prev => prev.map(a => a._id === id ? { ...a, ...updates } : a));
        if (selectedAlert?._id === id) {
          setSelectedAlert((prev: any) => ({ ...prev, ...updates }));
        }
      }
    } catch (err) {
      console.error('Failed to update alert', err);
    }
  };

  const handleAction = async (roomId: string, action: 'warn' | 'kill') => {
    try {
      await client.post(`/rooms/${roomId}/${action}`);
      RNAlert.alert("Success", `${action === 'warn' ? 'Warning sent' : 'Session killed'} successfully.`);
    } catch (e) {
      RNAlert.alert("Error", "Action failed.");
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity 
      activeOpacity={0.8}
      onPress={() => setSelectedAlert(item)}
      style={{ 
        backgroundColor: item.flagged ? 'rgba(251,191,36,0.1)' : theme.card, 
        borderColor: item.totalRisk >= 70 ? 'rgba(244,63,94,0.5)' : 'rgba(255,255,255,0.05)', 
        borderWidth: 1,
        opacity: item.falsePositive ? 0.6 : 1
      }}
      className="p-4 rounded-xl mb-3"
    >
      <View className="flex-row justify-between items-center mb-1">
        <View className="flex-row items-center">
          {item.flagged && <Icon name="flag" size={12} color="#fbbf24" style={{ marginRight: 4 }} />}
          {item.falsePositive && <Icon name="check-circle" size={12} color="#10b981" style={{ marginRight: 4 }} />}
          <Text style={{ color: theme.accent }} className="font-bold">{item.event || item.type}</Text>
        </View>
        <Text style={{ color: theme.textMuted }} className="text-xs">{new Date(item.time).toLocaleTimeString()}</Text>
      </View>
      <Text style={{ color: theme.text }} className="text-sm mb-2">{item.message}</Text>
      
      <View style={{ backgroundColor: 'rgba(255,255,255,0.03)' }} className="p-2 rounded mt-2 border border-white/5 flex-row justify-between items-center">
        <View>
          <Text style={{ color: theme.textMuted }} className="text-xs font-mono">Room: {item.room}</Text>
          {item.penalty > 0 && (
            <Text className="text-rose-400 text-xs font-bold mt-1">Penalty: +{item.penalty}</Text>
          )}
        </View>
        <View className="flex-row gap-2">
          <TouchableOpacity onPress={() => handleAction(item.room, 'warn')} style={{ backgroundColor: 'rgba(251,191,36,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 }}>
            <Text style={{ color: '#fbbf24', fontSize: 10, fontWeight: 'bold' }}>WARN</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleAction(item.room, 'kill')} style={{ backgroundColor: 'rgba(244,63,94,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 }}>
            <Text style={{ color: '#f43f5e', fontSize: 10, fontWeight: 'bold' }}>KILL</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ backgroundColor: theme.background }} className="flex-1 px-4 pt-4">
      <Text style={{ color: theme.text }} className="text-3xl font-black mb-4">Activity Feed</Text>

      {/* Behavioral Trends Mock */}
      <View style={{ backgroundColor: theme.card, borderColor: 'rgba(255,255,255,0.05)', borderWidth: 1 }} className="p-4 rounded-xl mb-4">
        <Text style={{ color: theme.text }} className="font-bold mb-2">Behavioral Trends</Text>
        <Text style={{ color: theme.textMuted }} className="text-xs mb-1">
          <Text style={{ color: '#f43f5e', fontWeight: 'bold' }}>Phone Detection</Text> accounts for most alerts today.
        </Text>
        <Text style={{ color: theme.textMuted }} className="text-xs">
          Consider enforcing stricter pre-room checks.
        </Text>
      </View>

      <FlatList
        data={alerts}
        keyExtractor={(item, idx) => item._id || (item.room + idx)}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
        contentContainerStyle={{ paddingBottom: 20 }}
      />

      {/* Deep Dive Modal */}
      <Modal visible={!!selectedAlert} animationType="slide" transparent={true} onRequestClose={() => setSelectedAlert(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' }}>
            {selectedAlert && (
              <ScrollView>
                <View className="flex-row justify-between items-center mb-6">
                  <View className="flex-row items-center">
                    <Icon name="shield-alert" size={24} color="#fbbf24" style={{ marginRight: 8 }} />
                    <Text style={{ color: theme.text, fontSize: 18, fontWeight: 'bold' }}>Alert Deep Dive</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedAlert(null)}>
                    <Icon name="close" size={24} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>

                <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                  <Text style={{ color: theme.textMuted, fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Violation Type</Text>
                  <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{selectedAlert.event || selectedAlert.type}</Text>
                </View>

                <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                  <Text style={{ color: theme.textMuted, fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Message</Text>
                  <Text style={{ color: theme.text, fontSize: 14 }}>{selectedAlert.message}</Text>
                </View>

                {/* Mock Graph Area */}
                <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, marginBottom: 24, height: 160, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', position: 'relative' }}>
                  <Text style={{ color: theme.textMuted, fontSize: 10, textTransform: 'uppercase', marginBottom: 8, zIndex: 10 }}>AI Evidence Graph</Text>
                  
                  {selectedAlert.evidenceUrl ? (
                    <Image 
                      source={{ uri: selectedAlert.evidenceUrl }} 
                      style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.6 }} 
                      resizeMode="cover"
                    />
                  ) : (
                    <Icon name="chart-bell-curve" size={40} color="#f43f5e" />
                  )}
                  
                  <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, marginTop: 8, zIndex: 10 }}>
                    <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: 'bold' }}>Confidence: 98%</Text>
                  </View>
                </View>

                <View className="flex-row justify-between mb-4">
                  <TouchableOpacity 
                    onPress={() => updateAlertStatus(selectedAlert._id, { falsePositive: !selectedAlert.falsePositive })}
                    style={{ flex: 1, backgroundColor: selectedAlert.falsePositive ? '#10b981' : 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 8, marginRight: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' }}
                  >
                    <Icon name="check-circle" size={16} color={selectedAlert.falsePositive ? '#000' : theme.text} style={{ marginRight: 6 }} />
                    <Text style={{ color: selectedAlert.falsePositive ? '#000' : theme.text, fontSize: 12, fontWeight: 'bold' }}>FALSE POSITIVE</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    onPress={() => updateAlertStatus(selectedAlert._id, { flagged: !selectedAlert.flagged })}
                    style={{ flex: 1, backgroundColor: selectedAlert.flagged ? '#fbbf24' : 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 8, marginLeft: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' }}
                  >
                    <Icon name="flag" size={16} color={selectedAlert.flagged ? '#000' : theme.text} style={{ marginRight: 6 }} />
                    <Text style={{ color: selectedAlert.flagged ? '#000' : theme.text, fontSize: 12, fontWeight: 'bold' }}>FLAG FOR REVIEW</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
