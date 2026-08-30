import React from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle, Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

interface AnimatedPressableProps extends PressableProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleValue?: number;
  hapticFeedback?: 'light' | 'medium' | 'heavy' | 'selection' | 'none';
}

const AnimatedPressableComponent = React.forwardRef<any, AnimatedPressableProps>(
  ({ children, style, scaleValue = 0.95, hapticFeedback = 'light', onPressIn, onPressOut, onPress, ...props }, ref) => {
    const scale = useSharedValue(1);

    const animatedStyle = useAnimatedStyle(() => {
      return {
        transform: [{ scale: scale.value }],
      };
    });

    const handlePressIn = (e: any) => {
      'worklet';
      scale.value = withSpring(scaleValue, { damping: 10, stiffness: 200 });
      if (onPressIn) onPressIn(e);
    };

    const handlePressOut = (e: any) => {
      'worklet';
      scale.value = withSpring(1, { damping: 10, stiffness: 200 });
      if (onPressOut) onPressOut(e);
    };

    const handlePress = (e: any) => {
      if (Platform.OS !== 'web') {
        if (hapticFeedback === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        else if (hapticFeedback === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        else if (hapticFeedback === 'heavy') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        else if (hapticFeedback === 'selection') Haptics.selectionAsync();
      }
      if (onPress) onPress(e);
    };

    return (
      <Animated.View style={[style, animatedStyle]}>
        {children}
        <Pressable
          ref={ref}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handlePress}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}
          {...props}
        />
      </Animated.View>
    );
  }
);

export const AnimatedPressable = AnimatedPressableComponent;
