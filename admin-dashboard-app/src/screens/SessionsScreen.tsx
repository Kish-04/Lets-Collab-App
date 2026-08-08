import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useApi } from '../context/ApiContext';

export default function SessionsScreen() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { client } = useApi();

  const fetchReports = async () => {
    try {
      const res = await client.get('/reports');
      if (res.data.success) {
        setSessions(res.data.sessionHistory);
      }
    } catch (err) {
      console.error('Failed to fetch sessions', err);
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
    <View className="bg-card p-4 rounded-xl border border-white/5 mb-3">
      <View className="flex-row justify-between items-center mb-2">
        <Text className="text-white font-black text-xl tracking-widest">{item.roomCode}</Text>
        <View className={`px-2 py-1 rounded ${item.endedAt ? 'bg-zinc-800' : 'bg-emerald-500/20'}`}>
          <Text className={`text-xs font-bold uppercase ${item.endedAt ? 'text-zinc-400' : 'text-emerald-400'}`}>
            {item.endedAt ? 'Completed' : 'Active'}
          </Text>
        </View>
      </View>
      
      <Text className="text-zinc-300 text-sm mb-1">Host: {item.hostName} ({item.hostEmail})</Text>
      <Text className="text-zinc-500 text-xs mb-3">
        Started: {new Date(item.startedAt).toLocaleString()}
      </Text>

      <View className="flex-row justify-between border-t border-white/5 pt-3">
        <View className="items-center">
          <Text className="text-zinc-400 text-xs font-bold uppercase">Users</Text>
          <Text className="text-white font-bold">{item.participantCount}</Text>
        </View>
        <View className="items-center">
          <Text className="text-zinc-400 text-xs font-bold uppercase">Alerts</Text>
          <Text className={`${item.alertCount > 0 ? 'text-rose-400' : 'text-white'} font-bold`}>
            {item.alertCount}
          </Text>
        </View>
        <View className="items-center">
          <Text className="text-zinc-400 text-xs font-bold uppercase">Evidence</Text>
          <Text className={`${item.evidenceCount > 0 ? 'text-amber-400' : 'text-white'} font-bold`}>
            {item.evidenceCount}
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <Text className="text-3xl font-black text-white mb-6">Sessions</Text>
      <FlatList
        data={sessions}
        keyExtractor={(item, idx) => item.roomCode + idx}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00d4ff" />}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </View>
  );
}
