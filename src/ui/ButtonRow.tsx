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
  /** Optional Maestro hook. Opt-in per call site — a button's LABEL can change
   * (e.g. "Next" -> "Let's begin"), so a text selector would need two
   *  cases and silently break when the copy is edited. */
  testID?: string;
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
        <Button testID={left.testID} title={left.title} variant={left.variant ?? 'secondary'} disabled={left.disabled} onPress={left.onPress} />
      </View>
      <View style={{ flex: rightFlex }}>
        <Button testID={right.testID} title={right.title} variant={right.variant ?? 'primary'} disabled={right.disabled} onPress={right.onPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  row: { flexDirection: 'row', gap: 10 },
}));
