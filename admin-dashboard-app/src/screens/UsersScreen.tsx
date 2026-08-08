import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useApi } from '../context/ApiContext';
import { useTheme } from '../context/ThemeContext';

export default function UsersScreen() {
  const [users, setUsers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { client } = useApi();
  const { theme } = useTheme();

  const fetchUsers = async () => {
    try {
      const res = await client.get('/users');
      if (res.data.success) {
        setUsers(res.data.users);
      }
    } catch (err) {
      console.error('Failed to fetch users', err);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchUsers();
    setRefreshing(false);
  };

  const toggleBan = async (id: string, currentlyBanned: boolean) => {
    try {
      const res = await client.post(`/users/${id}/ban`);
      if (res.data.success) {
        fetchUsers();
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to update ban status');
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <View 
      style={{ backgroundColor: theme.card, borderColor: 'rgba(255,255,255,0.05)', borderWidth: 1 }}
      className="p-4 rounded-xl mb-3 flex-row justify-between items-center"
    >
      <View className="flex-1">
        <Text style={{ color: theme.text }} className="font-bold text-lg mb-1">{item.name}</Text>
        <Text style={{ color: theme.textMuted }} className="text-sm">{item.email}</Text>
        <View className="flex-row items-center mt-2">
          <View 
            style={{ backgroundColor: item.role === 'admin' ? theme.accent + '20' : 'rgba(255,255,255,0.1)' }} 
            className="px-2 py-1 rounded mr-2"
          >
            <Text 
              style={{ color: item.role === 'admin' ? theme.accent : theme.textMuted }} 
              className="text-xs font-bold uppercase"
            >
              {item.role}
            </Text>
          </View>
          <Text style={{ color: theme.textMuted }} className="text-xs">Sessions: {item.sessionCount}</Text>
        </View>
      </View>
      
      <TouchableOpacity 
        className="px-4 py-2 rounded-lg"
        style={{ 
          backgroundColor: item.banned ? 'rgba(255,255,255,0.05)' : 'rgba(244, 63, 94, 0.2)',
          borderColor: item.banned ? 'transparent' : 'rgba(244, 63, 94, 0.5)',
          borderWidth: item.banned ? 0 : 1
        }}
        onPress={() => toggleBan(item._id, item.banned)}
      >
        <Text style={{ color: item.banned ? theme.textMuted : '#f43f5e', fontWeight: 'bold' }}>
          {item.banned ? 'Unban' : 'Ban'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={{ backgroundColor: theme.background }} className="flex-1 px-4 pt-4">
      <Text style={{ color: theme.text }} className="text-3xl font-black mb-6">Users</Text>
      <FlatList
        data={users}
        keyExtractor={(item) => item._id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </View>
  );
}
