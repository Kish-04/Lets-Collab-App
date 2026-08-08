import React, { useEffect, useRef } from 'react';
import { View, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { ApiProvider, useApi } from './src/context/ApiContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';

import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import UsersScreen from './src/screens/UsersScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import SettingsScreen from './src/screens/SettingsScreen';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { theme } = useTheme();
  const { client } = useApi();
  const knownSessions = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Request permission
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return;
    })();

    // Poll for new live sessions
    const interval = setInterval(async () => {
      try {
        const res = await client.get('/reports');
        if (res.data.success) {
          const sessions = res.data.sessionHistory || [];
          sessions.forEach((s: any) => {
            if (!s.endedAt && !knownSessions.current.has(s.roomCode)) {
              knownSessions.current.add(s.roomCode);
              // Trigger local notification
              Notifications.scheduleNotificationAsync({
                content: {
                  title: 'New Live Session! 📡',
                  body: `Room ${s.roomCode} is now active (Host: ${s.hostEmail}).`,
                  sound: true,
                },
                trigger: null,
              });
            }
          });
        }
      } catch (err) {}
    }, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '900' },
        tabBarStyle: { backgroundColor: theme.background, borderTopColor: 'rgba(255,255,255,0.05)' },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
      }}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="Users" component={UsersScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

function NavigationRoot() {
  const { token } = useApi();
  const { theme } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {token ? (
            <Stack.Screen name="Main" component={MainTabs} />
          ) : (
            <Stack.Screen name="Login" component={LoginScreen} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ApiProvider>
        <NavigationRoot />
      </ApiProvider>
    </ThemeProvider>
  );
}
