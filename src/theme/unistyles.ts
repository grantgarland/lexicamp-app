// Unistyles 3.0 runtime configuration.
// IMPORTANT: import this file ONCE, before any component renders — at the very top
// of the app entry (app/_layout.tsx) so `StyleSheet.create((theme) => …)` resolves.
import { StyleSheet } from 'react-native-unistyles';
import { lightTheme, darkTheme, breakpoints } from './theme';

type AppBreakpoints = typeof breakpoints;
type AppThemes = { light: typeof lightTheme; dark: typeof darkTheme };

// Make the theme + breakpoints fully typed at every `theme.…` call site.
declare module 'react-native-unistyles' {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

StyleSheet.configure({
  themes: { light: lightTheme, dark: darkTheme },
  breakpoints,
  settings: {
    initialTheme: 'light',   // light-only until dark mode is designed (14 §5)
    adaptiveThemes: false,
  },
});
