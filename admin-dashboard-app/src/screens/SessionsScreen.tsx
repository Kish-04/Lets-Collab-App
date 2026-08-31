import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useApi } from '../context/ApiContext';
import { useTheme } from '../context/ThemeContext';

export default function SessionsScreen() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { client } = useApi();
  const { theme } = useTheme();

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

  const SessionItem = ({ item }: { item: any }) => {
    const [expanded, setExpanded] = useState(false);
    return (
      <View style={{ backgroundColor: theme.card, borderColor: 'rgba(255,255,255,0.05)', borderWidth: 1 }} className="p-4 rounded-xl mb-3">
        <View className="flex-row justify-between items-center mb-2">
          <Text style={{ color: theme.text }} className="font-black text-xl tracking-widest">{item.roomCode}</Text>
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
          <TouchableOpacity onPress={() => setExpanded(!expanded)} className="items-center">
            <Text className="text-zinc-400 text-xs font-bold uppercase">Users {expanded ? '▲' : '▼'}</Text>
            <Text style={{ color: theme.text }} className="font-bold">{item.participantCount || item.participants?.length || 0}</Text>
          </TouchableOpacity>
          <View className="items-center">
            <Text className="text-zinc-400 text-xs font-bold uppercase">Alerts</Text>
            <Text style={{ color: item.alertCount > 0 ? '#f43f5e' : theme.text }} className="font-bold">
              {item.alertCount}
            </Text>
          </View>
          <View className="items-center">
            <Text className="text-zinc-400 text-xs font-bold uppercase">Evidence</Text>
            <Text style={{ color: item.evidenceCount > 0 ? '#fbbf24' : theme.text }} className="font-bold">
              {item.evidenceCount}
            </Text>
          </View>
        </View>
        
        {expanded && item.participants && item.participants.length > 0 && (
          <View className="mt-3 pt-3 border-t border-white/5">
            <Text className="text-zinc-500 text-[10px] font-bold uppercase mb-2">Participant Roster</Text>
            {item.participants.map((p: any, i: number) => (
              <View key={i} className="flex-row items-center mb-1">
                <View className="w-1.5 h-1.5 rounded-full bg-zinc-500 mr-2" />
                <Text style={{ color: theme.text }} className="text-xs flex-1">{p.name || p.email || 'Unknown User'}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={{ backgroundColor: theme.background }} className="flex-1 px-4 pt-4">
      <Text style={{ color: theme.text }} className="text-3xl font-black mb-6">Sessions</Text>
      <FlatList
        data={sessions}
        keyExtractor={(item, idx) => item.roomCode + idx}
        renderItem={({ item }) => <SessionItem item={item} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </View>
  );
}
