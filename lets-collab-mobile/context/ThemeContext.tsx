import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme, Platform } from 'react-native';
import { lightTheme, darkTheme, glassmorphicTheme } from '../constants/Colors';
import * as SecureStore from 'expo-secure-store';

export type Theme = 'dark' | 'light' | 'glassmorphic';

interface ThemeContextType {
  theme: Theme;
  colors: typeof darkTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  colors: darkTheme,
  setTheme: () => {},
  toggleTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>('dark');
  const systemTheme = useColorScheme();

  useEffect(() => {
    // Load saved theme
    const loadTheme = async () => {
      try {
        let savedTheme: string | null = null;
        if (Platform.OS === 'web') {
          savedTheme = localStorage.getItem('app_theme');
        } else {
          savedTheme = await SecureStore.getItemAsync('app_theme');
        }
        
        if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'glassmorphic') {
          setThemeState(savedTheme);
        } else if (systemTheme === 'light' || systemTheme === 'dark') {
          setThemeState(systemTheme);
        }
      } catch (e) {
        console.warn('Failed to load theme', e);
      }
    };
    
    loadTheme();
  }, [systemTheme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    if (Platform.OS === 'web') {
      localStorage.setItem('app_theme', newTheme);
    } else {
      SecureStore.setItemAsync('app_theme', newTheme);
    }
  };

  const toggleTheme = () => {
    const isDark = theme === 'dark' || theme === 'glassmorphic';
    setTheme(isDark ? 'light' : 'dark');
  };

  const colors = theme === 'light' ? lightTheme : theme === 'glassmorphic' ? glassmorphicTheme : darkTheme;

  return (
    <ThemeContext.Provider value={{ theme, colors, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
