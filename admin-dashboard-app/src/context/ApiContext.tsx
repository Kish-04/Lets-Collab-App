import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Set this to your local machine IP or Render/Vercel URL
export const BACKEND_URL = 'http://10.233.82.28:8081';

const api = axios.create({
  baseURL: BACKEND_URL,
});

api.interceptors.request.use(async (config) => {
  if (Platform.OS !== 'web') {
    const token = await SecureStore.getItemAsync('admin_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

type ApiContextType = {
  token: string | null;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  client: typeof api;
};

const ApiContext = createContext<ApiContextType | undefined>(undefined);

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      SecureStore.getItemAsync('admin_token').then((t) => {
        if (t) setToken(t);
      });
    }
  }, []);

  const login = async (newToken: string) => {
    setToken(newToken);
    if (Platform.OS !== 'web') {
      await SecureStore.setItemAsync('admin_token', newToken);
    }
  };

  const logout = async () => {
    setToken(null);
    if (Platform.OS !== 'web') {
      await SecureStore.deleteItemAsync('admin_token');
    }
  };

  return (
    <ApiContext.Provider value={{ token, login, logout, client: api }}>
      {children}
    </ApiContext.Provider>
  );
}

export function useApi() {
  const context = useContext(ApiContext);
  if (!context) throw new Error('useApi must be used within an ApiProvider');
  return context;
}
