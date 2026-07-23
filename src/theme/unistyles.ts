// Unistyles 3.0 runtime configuration.
// IMPORTANT: import this file ONCE, before any component renders — at the very top
// of the app entry (app/_layout.tsx) so `StyleSheet.create((theme) => …)` resolves.
import { StyleSheet } from 'react-native-unistyles';
import { lightTheme, darkTheme, breakpoints } from './theme';

type AppBreakpoints = typeof breakpoints;
type AppThemes = { light: typeof lightTheme; dark: typeof darkTheme };

// Make the theme + breakpoints fully typed at every `theme.…` call site.
// The empty-body `extends` interfaces are Unistyles' required module-augmentation idiom.
declare module 'react-native-unistyles' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface UnistylesThemes extends AppThemes {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

StyleSheet.configure({
  themes: { light: lightTheme, dark: darkTheme },
  breakpoints,
  settings: {
    // Device system color scheme drives light/dark. No in-app toggle (14 §5).
    // `adaptiveThemes` and `initialTheme` are mutually exclusive in Unistyles 3 —
    // with adaptive on, the runtime resolves the initial theme from the OS.
    adaptiveThemes: true,
  },
});
