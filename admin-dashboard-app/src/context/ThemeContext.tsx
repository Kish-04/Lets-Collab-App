import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';

export type Theme = {
  id: string;
  name: string;
  background: string;
  card: string;
  accent: string;
  text: string;
  textMuted: string;
};

export const themes: Theme[] = [
  {
    id: 'hacker-dark',
    name: 'Hacker Dark (Default)',
    background: '#030305',
    card: '#0d0d12',
    accent: '#00d4ff',
    text: '#ffffff',
    textMuted: '#a1a1aa'
  },
  {
    id: 'cyberpunk',
    name: 'Neon Cyberpunk',
    background: '#090514',
    card: '#150a2b',
    accent: '#f43f5e', // Rose 500
    text: '#ffffff',
    textMuted: '#d8b4fe'
  },
  {
    id: 'ocean-blue',
    name: 'Deep Ocean',
    background: '#020617',
    card: '#0f172a',
    accent: '#38bdf8', // Sky 400
    text: '#f8fafc',
    textMuted: '#94a3b8'
  },
  {
    id: 'light-mode',
    name: 'Clean Light',
    background: '#f4f4f5',
    card: '#ffffff',
    accent: '#2563eb', // Blue 600
    text: '#18181b',
    textMuted: '#52525b'
  }
];

type ThemeContextType = {
  theme: Theme;
  setTheme: (id: string) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setActiveTheme] = useState<Theme>(themes[0]);

  useEffect(() => {
    SecureStore.getItemAsync('app_theme').then((savedThemeId) => {
      if (savedThemeId) {
        const found = themes.find(t => t.id === savedThemeId);
        if (found) setActiveTheme(found);
      }
    });
  }, []);

  const setTheme = async (id: string) => {
    const found = themes.find(t => t.id === id);
    if (found) {
      setActiveTheme(found);
      await SecureStore.setItemAsync('app_theme', id);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
