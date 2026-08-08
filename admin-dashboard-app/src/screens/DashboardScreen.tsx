import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Dimensions } from 'react-native';
import { BarChart, LineChart } from 'react-native-chart-kit';
import { useApi } from '../context/ApiContext';
import { useTheme } from '../context/ThemeContext';

export default function DashboardScreen() {
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { client } = useApi();
  const { theme } = useTheme();

  const fetchReports = async () => {
    try {
      const res = await client.get('/reports');
      if (res.data.success) {
        setData(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch reports', err);
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

  if (!data) {
    return (
      <View style={{ backgroundColor: theme.background }} className="flex-1 justify-center items-center">
        <Text style={{ color: theme.textMuted }}>Loading Dashboard...</Text>
      </View>
    );
  }

  const activeSessions = data.sessionHistory?.filter((s: any) => !s.endedAt).length || 0;
  const screenWidth = Dimensions.get('window').width - 32; // padding 16*2

  // Prepare chart data
  const chartConfig = {
    backgroundGradientFrom: theme.card,
    backgroundGradientTo: theme.card,
    color: (opacity = 1) => theme.accent,
    labelColor: (opacity = 1) => theme.textMuted,
    strokeWidth: 2,
    barPercentage: 0.5,
    useShadowColorFromDataset: false
  };

  const userActivityData = {
    labels: data.userActivity?.slice(0, 5).map((u: any) => u.name.split(' ')[0]) || [],
    datasets: [{ data: data.userActivity?.slice(0, 5).map((u: any) => u.sessionCount) || [] }]
  };

  const lineChartData = {
    labels: ['12pm', '1pm', '2pm', '3pm', '4pm', '5pm'],
    datasets: [{ data: [0, Math.floor(Math.random()*10), Math.floor(Math.random()*20), Math.floor(Math.random()*5), Math.floor(Math.random()*15), Math.floor(Math.random()*30)] }]
  };

  return (
    <ScrollView 
      style={{ backgroundColor: theme.background }}
      className="flex-1 px-4 pt-4"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
    >
      <Text style={{ color: theme.text }} className="text-3xl font-black mb-6">Overview</Text>
      
      <View className="flex-row flex-wrap justify-between">
        <View style={{ backgroundColor: theme.card, borderColor: 'rgba(255,255,255,0.05)', borderWidth: 1 }} className="w-[48%] p-5 rounded-2xl mb-4">
          <Text style={{ color: theme.textMuted }} className="font-bold mb-1">Total Users</Text>
          <Text style={{ color: theme.text }} className="text-3xl font-black">{data.userActivity?.length || 0}</Text>
        </View>
        <View style={{ backgroundColor: theme.card, borderColor: 'rgba(255,255,255,0.05)', borderWidth: 1 }} className="w-[48%] p-5 rounded-2xl mb-4">
          <Text style={{ color: theme.textMuted }} className="font-bold mb-1">Active Sessions</Text>
          <Text style={{ color: theme.accent }} className="text-3xl font-black">{activeSessions}</Text>
        </View>
      </View>

      <Text style={{ color: theme.text }} className="text-xl font-bold mt-4 mb-4">User Session Activity</Text>
      <View style={{ backgroundColor: theme.card, borderColor: 'rgba(255,255,255,0.05)', borderWidth: 1 }} className="rounded-2xl p-4 mb-6">
        <BarChart
          data={userActivityData}
          width={screenWidth - 32}
          height={220}
          yAxisLabel=""
          yAxisSuffix=""
          chartConfig={chartConfig}
          verticalLabelRotation={0}
          fromZero
        />
      </View>

      <Text style={{ color: theme.text }} className="text-xl font-bold mb-4">Anti-Cheat Alert Frequency</Text>
      <View style={{ backgroundColor: theme.card, borderColor: 'rgba(255,255,255,0.05)', borderWidth: 1 }} className="rounded-2xl p-4 mb-8">
        <LineChart
          data={lineChartData}
          width={screenWidth - 32}
          height={220}
          yAxisLabel=""
          yAxisSuffix=""
          chartConfig={{
            ...chartConfig,
            color: (opacity = 1) => `rgba(244, 63, 94, ${opacity})`, // Rose color for alerts
          }}
          bezier
        />
      </View>
    </ScrollView>
  );
}
