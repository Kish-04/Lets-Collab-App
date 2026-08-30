import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface AppLogoProps {
  size?: 'small' | 'default' | 'large';
  style?: any;
}

export const AppLogo: React.FC<AppLogoProps> = ({ size = 'default', style }) => {
  const { colors } = useTheme();

  const sizeStyles = {
    small: { icon: 32, title: 20, subtitle: 8, gap: 8 },
    default: { icon: 56, title: 36, subtitle: 11, gap: 12 },
    large: { icon: 72, title: 48, subtitle: 12, gap: 16 }
  };

  const s = sizeStyles[size];

  return (
    <View style={[styles.container, { gap: s.gap }, style]}>
      <View style={[styles.iconContainer, { width: s.icon, height: s.icon }]}>
        <Image 
          source={require('../assets/images/logo.png')} 
          style={styles.image}
          resizeMode="contain"
        />
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { fontSize: s.title, color: colors.textPrimary }]}>
          Let's Collab!
        </Text>
        <Text style={[styles.subtitle, { fontSize: s.subtitle, color: colors.textDim }]}>
          WORK TOGETHER. STAY IN CONTROL.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  textContainer: {
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Inter_900Black',
    lineHeight: undefined,
    letterSpacing: -1,
    marginBottom: 0,
    includeFontPadding: false,
  },
  subtitle: {
    fontFamily: 'SpaceMono',
    letterSpacing: 1.5,
    marginTop: 2,
    includeFontPadding: false,
  }
});
