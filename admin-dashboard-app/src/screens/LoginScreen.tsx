import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useApi } from '../context/ApiContext';
import { useTheme } from '../context/ThemeContext';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { client, login } = useApi();
  const { theme } = useTheme();

  const handleLogin = async () => {
    if (!email || !password) return setError('Email and password required');
    setLoading(true);
    setError('');
    
    try {
      const res = await client.post('/login', { email, password });
      if (res.data.success && res.data.token) {
        if (res.data.user?.role === 'admin') {
          await login(res.data.token);
        } else {
          setError('Access denied: Admins only');
        }
      } else {
        setError('Login failed');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 justify-center items-center px-6" style={{ backgroundColor: theme.background }}>
      <View 
        className="w-full max-w-md p-8 rounded-xl border shadow-2xl"
        style={{ backgroundColor: theme.card, borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <Text style={{ color: theme.accent }} className="text-xs font-bold tracking-widest mb-2 uppercase">Administrator Sign In</Text>
        <Text style={{ color: theme.text }} className="text-3xl font-bold mb-2">Welcome back</Text>
        <Text style={{ color: theme.textMuted }} className="text-sm mb-8">Use an administrator account to continue.</Text>

        {error ? <Text className="text-rose-500 text-sm mb-4">{error}</Text> : null}

        <Text style={{ color: theme.textMuted }} className="text-xs font-medium mb-2 ml-1">Administrator ID</Text>
        <TextInput
          className="w-full h-12 border-0 rounded-md px-4 font-medium mb-6"
          style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: theme.text }}
          placeholder="admin@letscollab.com"
          placeholderTextColor={theme.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
        />
        
        <Text style={{ color: theme.textMuted }} className="text-xs font-medium mb-2 ml-1">Password</Text>
        <TextInput
          className="w-full h-12 border-0 rounded-md px-4 font-medium mb-8"
          style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: theme.text }}
          placeholder="••••••••"
          placeholderTextColor={theme.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity 
          className="w-full h-12 rounded-md justify-center items-center shadow-lg"
          style={{ backgroundColor: theme.accent }}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={theme.background} />
          ) : (
            <Text style={{ color: theme.background }} className="font-bold text-base">Enter Console</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
