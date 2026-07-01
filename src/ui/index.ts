// Lexicamp UI kit — primitives. Compose these everywhere; never hardcode tokens.
// Grows through P2 (Sheet, TabBar, icons…).
export { Text, RawText, FONT_SCALE_MAX, type TextProps, type TextVariant } from './Text';
export { Screen, SCREEN_MAX_WIDTH, type ScreenProps } from './Screen';
export { Tooltip, InfoDot, type TooltipProps } from './Tooltip';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export { Card, type CardProps } from './Card';
export { TierBadge, type TierBadgeProps, type TierBadgeVariant } from './TierBadge';
export { Toggle, type ToggleProps } from './Toggle';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Input, type InputProps } from './Input';
export { ProgressDots, type ProgressDotsProps } from './ProgressDots';
export { Sheet, type SheetProps } from './Sheet';
export { TabBar, TAB_BAR_CORE_HEIGHT, type TabBarProps, type TabId } from './TabBar';
export {
  IconHome,
  IconList,
  IconChart,
  IconGear,
  IconSearchPlus,
  IconWifi,
  IconChevronRight,
  IconChevronDown,
  IconChevronUp,
  IconArrowRight,
  IconTrash,
  IconFolderPlus,
  IconLock,
  IconBook,
  IconCheck,
  IconPlay,
  IconFire,
  IconClock,
  IconCalendar,
  IconSearch,
  IconX,
  IconArrowUp,
  IconArrowDown,
  IconMountain,
  IconInfo,
  IconSliders,
  type IconProps,
} from './icons';
export { PRESS_OPACITY, pressableOpacity } from './pressable';
export { ForgettingCurve, IntervalTrack, CardSorter, DailyPractice, SummitScene } from './illustrations';

// ── P3 composed domain components ──
export { RatingButtons, type RatingButtonsProps, type Rating } from './RatingButtons';
export { WordRow, type WordRowProps, type WordItem } from './WordRow';
export { DeckRow, type DeckRowProps, type DeckItem } from './DeckRow';
export {
  TranslationCard,
  type TranslationCardProps,
  type TranslationResult,
  type Translation,
} from './TranslationCard';
export { WordCharInput, type WordCharInputProps } from './WordCharInput';
export { MasteryCard, type MasteryCardProps } from './MasteryCard';
export {
  QuizCardFront,
  QuizCardBack,
  type QuizCardFrontProps,
  type QuizCardBackProps,
  type QuizCardData,
  type QuizMode,
} from './QuizCard';
