import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme, themes } from '../context/ThemeContext';
import { useApi } from '../context/ApiContext';

export default function SettingsScreen() {
  const { theme, setTheme } = useTheme();
  const { logout } = useApi();

  return (
    <ScrollView style={{ backgroundColor: theme.background }} className="flex-1 px-4 pt-4">
      <Text style={{ color: theme.text }} className="text-3xl font-black mb-6">Settings</Text>
      
      <View style={{ backgroundColor: theme.card, borderColor: 'rgba(255,255,255,0.05)', borderWidth: 1 }} className="p-4 rounded-xl mb-6">
        <Text style={{ color: theme.text }} className="text-lg font-bold mb-4">Theme Customizer</Text>
        
        {themes.map((t) => (
          <TouchableOpacity
            key={t.id}
            onPress={() => setTheme(t.id)}
            className="flex-row items-center justify-between mb-4 p-3 rounded-lg border"
            style={{ 
              backgroundColor: t.id === theme.id ? t.accent + '20' : 'rgba(255,255,255,0.02)',
              borderColor: t.id === theme.id ? t.accent : 'rgba(255,255,255,0.1)'
            }}
          >
            <View className="flex-row items-center gap-3">
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: t.accent }} />
              <Text style={{ color: theme.text }} className="font-bold">{t.name}</Text>
            </View>
            {t.id === theme.id && (
              <Text style={{ color: t.accent }} className="text-xs font-black uppercase">Active</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity 
        className="w-full py-4 rounded-xl items-center border border-rose-500/30"
        style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)' }}
        onPress={logout}
      >
        <Text className="text-rose-500 font-bold text-lg">Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
