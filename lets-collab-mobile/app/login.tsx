import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Animated, Pressable, ImageBackground, Dimensions, Easing } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import { BACKEND_URL, storeAuthToken, storeEmail } from '../lib/api';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { AppLogo } from '../components/AppLogo';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

export default function LoginScreen() {
  const { colors, theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedInput, setFocusedInput] = useState<'email' | 'password' | null>(null);

  // Animation values
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      })
    ]).start();
  }, []);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
      speed: 20,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      bounciness: 12,
    }).start();
  };

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please enter both email and password.");
      return;
    }

    setLoading(true);
    
    // Satisfying buffer animation
    Animated.timing(fadeAnim, {
      toValue: 0.8,
      duration: 300,
      useNativeDriver: true,
    }).start();

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), password })
      });

      const data = await response.json();

      if (response.ok && data.token) {
        await storeAuthToken(data.token);
        await storeEmail(data.user?.email || email.toLowerCase().trim());
        
        // Satisfying transition out
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: -30,
            duration: 400,
            useNativeDriver: true,
          })
        ]).start(() => {
          router.replace('/(tabs)');
        });
      } else {
        Alert.alert("Login Failed", data.error || "Invalid credentials.");
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Network Error", "Could not connect to the server.");
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } finally {
      setLoading(false);
    }
  };

  const isGlass = theme === 'glassmorphic';
  const isDark = theme === 'dark' || isGlass;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Base Background */}
      <View style={[styles.baseBg, { backgroundColor: colors.bg }]} />

      {/* Grid Pattern */}
      <ImageBackground 
        source={require('../assets/images/grid.svg')} 
        style={styles.gridBg}
        imageStyle={{ opacity: isDark ? 0.15 : 0.05, resizeMode: 'repeat' }}
      >
        <LinearGradient
          colors={['transparent', colors.bg]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
      </ImageBackground>



      <KeyboardAvoidingView 
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          
          <View style={styles.header}>
            <AppLogo size="large" />
          </View>

          {/* Frosted Glass Container */}
          <BlurView intensity={isGlass ? 80 : (isDark ? 30 : 60)} tint={isDark ? "dark" : "light"} style={[styles.glassContainer, { borderColor: colors.border }]}>
            <View style={[styles.glassInner, { backgroundColor: colors.glassBg }]}>
              
              <Text style={[styles.label, { color: colors.textSecondary }]}>EMAIL ADDRESS</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary },
                  focusedInput === 'email' && { borderColor: colors.accent, backgroundColor: isDark ? 'rgba(0, 212, 255, 0.05)' : 'rgba(0, 212, 255, 0.02)' }
                ]}
                placeholder="name@example.com"
                placeholderTextColor={colors.textDim}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                onFocus={() => setFocusedInput('email')}
                onBlur={() => setFocusedInput(null)}
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>PASSWORD</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary },
                  focusedInput === 'password' && { borderColor: colors.accent, backgroundColor: isDark ? 'rgba(0, 212, 255, 0.05)' : 'rgba(0, 212, 255, 0.02)' }
                ]}
                placeholder="••••••••"
                placeholderTextColor={colors.textDim}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                onFocus={() => setFocusedInput('password')}
                onBlur={() => setFocusedInput(null)}
              />

              {/* Animated Gradient Button */}
              <Animated.View style={{ transform: [{ scale: scaleAnim }], marginTop: 12 }}>
                <Pressable 
                  style={({ pressed }) => [
                    styles.button,
                    pressed && styles.buttonPressed
                  ]} 
                  onPress={handleLogin}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  disabled={loading}
                >
                  <LinearGradient
                    colors={[colors.accent, colors.violet]}
                    style={styles.buttonGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    {loading ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.buttonText}>Authenticate Session</Text>
                    )}
                  </LinearGradient>
                </Pressable>
              </Animated.View>
              
            </View>
          </BlurView>

        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  baseBg: {
    ...StyleSheet.absoluteFill,
  },
  gridBg: {
    ...StyleSheet.absoluteFill,
  },

  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    zIndex: 10,
  },
  header: {
    marginBottom: 48,
    alignItems: 'center',
  },
  glassContainer: {
    borderRadius: 12, // Desktop-style subtle radius
    overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: '#0f0f1a', // Solid surface matching desktop panels
    shadowColor: '#00d4ff', // Subtle Desktop glow
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  glassInner: {
    padding: 32,
  },
  label: {
    fontSize: 11,
    fontFamily: 'SpaceMono',
    marginBottom: 10,
    letterSpacing: 1.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    fontSize: 14,
    fontFamily: 'Inter_500Medium', 
  },
  button: {
    borderRadius: 8, 
    overflow: 'hidden',
    shadowColor: '#6e3fff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'Inter_700Bold', 
    letterSpacing: 0.5,
  }
});
