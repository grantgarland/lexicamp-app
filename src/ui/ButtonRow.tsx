// ButtonRow — the shared two-button footer group (secondary + primary, weighted).
// Used for Reset · Apply (filter sheet), Delete · Study (deck detail), etc. Defaults to
// a 1 : 2 flex split (secondary narrower), matching the prototype.
import { View, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Button, type ButtonVariant } from './Button';

export interface ButtonRowButton {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
}

export interface ButtonRowProps {
  left: ButtonRowButton;
  right: ButtonRowButton;
  leftFlex?: number;
  rightFlex?: number;
  style?: ViewStyle;
}

export function ButtonRow({ left, right, leftFlex = 1, rightFlex = 2, style }: ButtonRowProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={{ flex: leftFlex }}>
        <Button title={left.title} variant={left.variant ?? 'secondary'} disabled={left.disabled} onPress={left.onPress} />
      </View>
      <View style={{ flex: rightFlex }}>
        <Button title={right.title} variant={right.variant ?? 'primary'} disabled={right.disabled} onPress={right.onPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  row: { flexDirection: 'row', gap: 10 },
}));
