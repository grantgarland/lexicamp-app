// Icon set (react-native-svg) — ported from the prototypes' inline nav SVGs.
// Stroke-based, 24×24 viewBox (SearchPlus 26×26). Pass `size` + `color`.
// Grows as screens need more glyphs; keep them here so the kit owns its icons.
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export interface IconProps {
  size?: number;
  color?: string;
}

const STROKE = '#3e4951'; // text-body default; callers usually override

export function IconHome({ size = 22, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 12L12 3l9 9" />
      <Path d="M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
    </Svg>
  );
}

export function IconList({ size = 22, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Line x1="9" y1="6" x2="21" y2="6" />
      <Line x1="9" y1="12" x2="21" y2="12" />
      <Line x1="9" y1="18" x2="21" y2="18" />
      <Circle cx="3.5" cy="6" r="1.1" fill={color} stroke="none" />
      <Circle cx="3.5" cy="12" r="1.1" fill={color} stroke="none" />
      <Circle cx="3.5" cy="18" r="1.1" fill={color} stroke="none" />
    </Svg>
  );
}

export function IconChart({ size = 22, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="12" width="4" height="9" rx="1.2" />
      <Rect x="10" y="7" width="4" height="14" rx="1.2" />
      <Rect x="17" y="3" width="4" height="18" rx="1.2" />
    </Svg>
  );
}

export function IconGear({ size = 22, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx="12" cy="12" r="3" />
      <Path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
    </Svg>
  );
}

export function IconChevronRight({ size = 14, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function IconTrash({ size = 18, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 6h18" />
      <Path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
      <Path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <Path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function IconFolderPlus({ size = 18, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <Path d="M12 11v4M10 13h4" />
    </Svg>
  );
}

export function IconLock({ size = 18, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="5" y="11" width="14" height="10" rx="2" />
      <Path d="M8 11V7a4 4 0 018 0v4" />
    </Svg>
  );
}

export function IconArrowRight({ size = 12, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function IconChevronDown({ size = 14, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function IconChevronUp({ size = 14, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 15l6-6 6 6" />
    </Svg>
  );
}

export function IconBook({ size = 16, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <Path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </Svg>
  );
}

export function IconCheck({ size = 16, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 13l4 4L19 7" />
    </Svg>
  );
}

export function IconSearch({ size = 17, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="11" cy="11" r="7" />
      <Path d="M21 21l-4.3-4.3" />
    </Svg>
  );
}

export function IconX({ size = 12, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconFire({ size = 18, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <Path d="M12 2C9 6 7.5 8 7.5 11.5a4.5 4.5 0 009 0c0-1.8-.9-3.2-1.8-4.3.1 1.3-.6 2.1-1.4 2.1-1 0-1.5-.8-1.5-2C11.8 5.6 12 3.8 12 2z" />
    </Svg>
  );
}

export function IconClock({ size = 15, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </Svg>
  );
}

export function IconCalendar({ size = 15, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="5" width="18" height="16" rx="2" />
      <Path d="M3 9h18M8 3v4M16 3v4" />
    </Svg>
  );
}

export function IconArrowUp({ size = 12, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 19V5M6 11l6-6 6 6" />
    </Svg>
  );
}

export function IconArrowDown({ size = 12, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 5v14M18 13l-6 6-6-6" />
    </Svg>
  );
}

export function IconMountain({ size = 36, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <Path d="M3 20l6-11 3.5 6 2.5-4 6 9z" />
    </Svg>
  );
}

export function IconPlay({ size = 18, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <Path d="M7 5v14l11-7z" />
    </Svg>
  );
}

export function IconInfo({ size = 13, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 11v5" />
      <Path d="M12 8h.01" />
    </Svg>
  );
}

export function IconWifi({ size = 14, color = STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Path d="M4.5 12a10.5 10.5 0 0115 0" />
      <Path d="M8 15.5a5.5 5.5 0 018 0" />
      <Circle cx="12" cy="19" r="1" fill={color} stroke="none" />
    </Svg>
  );
}

export function IconSearchPlus({ size = 26, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round">
      <Circle cx="11" cy="11" r="6.5" />
      <Line x1="15.8" y1="15.8" x2="22" y2="22" />
      <Line x1="11" y1="7.5" x2="11" y2="14.5" />
      <Line x1="7.5" y1="11" x2="14.5" y2="11" />
    </Svg>
  );
}
