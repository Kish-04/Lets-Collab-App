import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useApi } from '../context/ApiContext';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { client, login } = useApi();

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
    <View className="flex-1 justify-center items-center px-6" style={{ backgroundColor: '#0a101f' }}>
      <View className="w-full max-w-md p-8 bg-[#111827] rounded-xl border border-white/10 shadow-2xl">
        <Text className="text-blue-500 text-xs font-bold tracking-widest mb-2 uppercase">Administrator Sign In</Text>
        <Text className="text-3xl font-bold text-white mb-2">Welcome back</Text>
        <Text className="text-gray-400 text-sm mb-8">Use an administrator account to continue.</Text>

        {error ? <Text className="text-red-500 text-sm mb-4">{error}</Text> : null}

        <Text className="text-gray-400 text-xs font-medium mb-2 ml-1">Administrator ID</Text>
        <TextInput
          className="w-full h-12 bg-[#ebf3ff] border-0 rounded-md px-4 text-gray-900 font-medium mb-6"
          placeholder="admin@letscollab.com"
          placeholderTextColor="#9ca3af"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
        />
        
        <Text className="text-gray-400 text-xs font-medium mb-2 ml-1">Password</Text>
        <TextInput
          className="w-full h-12 bg-[#ebf3ff] border-0 rounded-md px-4 text-gray-900 font-medium mb-8"
          placeholder="••••••••"
          placeholderTextColor="#9ca3af"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity 
          className="w-full h-12 bg-blue-500 rounded-md justify-center items-center shadow-lg"
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-bold text-base">Enter Console</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
