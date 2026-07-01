// Consolidated "pressable" affordance convention.
//
// The kit signals interactivity two ways, applied consistently everywhere:
//  1. PRESS FEEDBACK — every custom pressable element dims to PRESS_OPACITY on press
//     (subtle, stable, no layout shift). Use `pressableOpacity(pressed)` in a
//     Pressable's function-style, or `PRESS_OPACITY` directly.
//  2. INFO AFFORDANCE — an element that *reveals contextual help on press* is wrapped
//     in `<Tooltip>`, which additionally shows a subtle ⓘ indicator (the universal
//     "there's info here" cue). See Tooltip.
//
// Obvious controls (Buttons, list rows) already read as tappable and only need (1);
// non-obvious triggers (an icon, a badge, a stat) use (1)+(2).

/** Opacity a pressable element dims to while pressed. */
export const PRESS_OPACITY = 0.6;

/** Consistent press-opacity for a Pressable's function-style. */
export const pressableOpacity = (pressed: boolean) => ({ opacity: pressed ? PRESS_OPACITY : 1 });
