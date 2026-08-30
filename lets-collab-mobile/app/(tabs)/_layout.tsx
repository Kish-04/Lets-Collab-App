import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LayoutGrid, Activity, ShieldAlert, Link as LinkIcon, Users, FileText } from 'lucide-react-native';
import { Platform, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

export default function TabLayout() {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark' || theme === 'glassmorphic';

  return (
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
    </Tabs>
  );
}
