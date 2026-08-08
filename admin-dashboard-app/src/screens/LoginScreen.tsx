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
    <View className="flex-1 justify-center items-center bg-background px-6">
      <View className="w-full max-w-sm p-8 bg-card rounded-3xl border border-white/10">
        <Text className="text-3xl font-black text-white text-center mb-2">Admin Panel</Text>
        <Text className="text-zinc-400 text-center mb-8">Sign in to Let's Collab</Text>

        {error ? <Text className="text-red-500 text-center mb-4">{error}</Text> : null}

        <TextInput
          className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-4 text-white mb-4"
          placeholder="Admin Email"
          placeholderTextColor="#71717a"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
        />
        
        <TextInput
          className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-4 text-white mb-6"
          placeholder="Password"
          placeholderTextColor="#71717a"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity 
          className="w-full h-12 bg-accent rounded-xl justify-center items-center"
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text className="text-black font-black text-lg">Login</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
