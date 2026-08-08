import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useApi } from '../context/ApiContext';
import { useTheme } from '../context/ThemeContext';

export default function ActivityScreen() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
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

  const renderItem = ({ item }: { item: any }) => (
    <View 
      style={{ backgroundColor: theme.card, borderColor: 'rgba(255,255,255,0.05)', borderWidth: 1 }}
      className="p-4 rounded-xl mb-3"
    >
      <View className="flex-row justify-between items-center mb-1">
        <Text style={{ color: theme.accent }} className="font-bold">{item.event}</Text>
        <Text style={{ color: theme.textMuted }} className="text-xs">{new Date(item.time).toLocaleTimeString()}</Text>
      </View>
      <Text style={{ color: theme.text }} className="text-sm mb-2">{item.message}</Text>
      
      <View style={{ backgroundColor: 'rgba(255,255,255,0.03)' }} className="p-2 rounded mt-2 border border-white/5">
        <Text style={{ color: theme.textMuted }} className="text-xs font-mono">Room: {item.room}</Text>
        <Text style={{ color: theme.textMuted }} className="text-xs font-mono">Host: {item.hostEmail}</Text>
        {item.penalty > 0 && (
          <Text className="text-rose-400 text-xs font-bold mt-1">Penalty: +{item.penalty} Risk Score</Text>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ backgroundColor: theme.background }} className="flex-1 px-4 pt-4">
      <Text style={{ color: theme.text }} className="text-3xl font-black mb-6">Activity Feed</Text>
      <FlatList
        data={alerts}
        keyExtractor={(item, idx) => item.room + idx}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </View>
  );
}
