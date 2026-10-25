import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LayoutGrid, Activity, ShieldAlert, Link as LinkIcon, Users, FileText, Scale, MonitorPlay } from 'lucide-react-native';
import { Platform, StyleSheet, type ColorValue } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { getStoredRole } from '../../lib/api';
import { AdminDataProvider } from '../../lib/adminData';

export default function TabLayout() {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark' || theme === 'glassmorphic';
  // Accounts known not to be administrators only get the Overview tab (join a room as a participant).
  // A login from before roles were stored (null) keeps every tab; the server refuses admin data anyway.
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => { void getStoredRole().then(setRole); }, []);
  const adminOnly = role === 'user' ? { href: null } : {};
  const icon = (Icon: typeof Activity) => {
    const TabIcon = ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <Icon
        size={24}
        color={color}
        strokeWidth={focused ? 3 : 2}
        style={focused && { shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 15, shadowOffset: { width: 0, height: 0 } }}
      />
    );
    TabIcon.displayName = 'TabIcon';
    return TabIcon;
  };

  return (
    <AdminDataProvider>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: Platform.OS === 'ios' ? 96 : 80,
          borderTopWidth: 1,
          borderTopColor: colors.borderBright,
          backgroundColor: 'transparent',
          elevation: 0,
        },
        tabBarBackground: () => (
          <BlurView
            tint={isDark ? "dark" : "light"}
            intensity={100}
            style={StyleSheet.absoluteFill}
          />
        ),
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: {
          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
          fontSize: 10,
          fontWeight: '900',
          marginBottom: Platform.OS === 'ios' ? 0 : 8,
          letterSpacing: 1,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Overview',
          tabBarIcon: ({ color, focused }) => (
            <LayoutGrid 
              size={24} 
              color={color} 
              strokeWidth={focused ? 3 : 2}
              style={focused && { shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 15, shadowOffset: { width: 0, height: 0 } }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          ...adminOnly,
          title: 'Sessions',
          tabBarIcon: ({ color, focused }) => (
            <Activity 
              size={24} 
              color={color} 
              strokeWidth={focused ? 3 : 2}
              style={focused && { shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 15, shadowOffset: { width: 0, height: 0 } }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          ...adminOnly,
          title: 'Alerts',
          tabBarIcon: ({ color, focused }) => (
            <ShieldAlert 
              size={24} 
              color={color} 
              strokeWidth={focused ? 3 : 2}
              style={focused && { shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 15, shadowOffset: { width: 0, height: 0 } }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="blockchain"
        options={{
          ...adminOnly,
          title: 'Blockchain',
          tabBarIcon: ({ color, focused }) => (
            <LinkIcon 
              size={24} 
              color={color} 
              strokeWidth={focused ? 3 : 2}
              style={focused && { shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 15, shadowOffset: { width: 0, height: 0 } }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="users"
        options={{
          ...adminOnly,
          title: 'Users',
          tabBarIcon: ({ color, focused }) => (
            <Users 
              size={24} 
              color={color} 
              strokeWidth={focused ? 3 : 2}
              style={focused && { shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 15, shadowOffset: { width: 0, height: 0 } }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          ...adminOnly,
          title: 'Reports',
          tabBarIcon: ({ color, focused }) => (
            <FileText 
              size={24} 
              color={color} 
              strokeWidth={focused ? 3 : 2}
              style={focused && { shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 15, shadowOffset: { width: 0, height: 0 } }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="wall"
        options={{
          ...adminOnly,
          title: 'Wall',
          tabBarIcon: icon(MonitorPlay),
        }}
      />
      <Tabs.Screen
        name="review"
        options={{
          ...adminOnly,
          title: 'Review',
          tabBarIcon: icon(Scale),
        }}
      />
    </Tabs>
    </AdminDataProvider>
  );
}
