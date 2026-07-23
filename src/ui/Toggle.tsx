// Toggle — iOS-style on/off switch, ported from `_shared/toggle.js`.
// 48×28 track, 22px spring thumb; brand when on, slate-300 off. Self-contained.
import { useEffect, useState } from 'react';
import { Animated, Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

export interface ToggleProps {
  value: boolean;
  onValueChange?: (next: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ value, onValueChange, disabled = false }: ToggleProps) {
  const { theme } = useUnistyles();
  // Lazy `useState` init (not `useRef().current`) so the stable Animated.Value can be
  // read during render — `.interpolate` below runs at render time. Never re-set.
  const [anim] = useState(() => new Animated.Value(value ? 1 : 0));

  useEffect(() => {
    Animated.spring(anim, {
      toValue: value ? 1 : 0,
      useNativeDriver: false, // animating backgroundColor + layout
      friction: 7,
      tension: 80,
    }).start();
  }, [value, anim]);

  const backgroundColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.color.borderStrong, theme.color.brand],
  });
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 20] });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange?.(!value)}
      style={{ opacity: disabled ? 0.5 : 1 }}
      hitSlop={8}
    >
      <Animated.View
        style={{ width: 48, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center', backgroundColor }}
      >
        <Animated.View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: '#fff',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.2)',
            transform: [{ translateX }],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
