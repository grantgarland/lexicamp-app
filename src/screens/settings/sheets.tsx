// Settings deep-editor sheets (SE-01…SE-08), assembled against settings/Settings.html.
// Each is a shared-kit `Sheet`; premium-gated editors surface a `PremiumGate` callout
// that routes to the paywall via `onUpgrade`. Kept in their own module so SettingsScreen
// stays a thin hub.
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { type ReactNode, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { findLanguage, TRANSLATABLE_LANGUAGES } from '@/constants';
import { languageName } from '@/domain/derive';
import type { LanguageCode, NotificationPrefs, Profile } from '@/domain/types';
import { useTranslation } from '@/i18n';
import { registerForPush } from '@/notifications/push';
import { useNotificationPrefs, useUpdateNotificationPrefs } from '@/query/hooks';
import { QUIZ_LENGTH_FREE, usePrefsStore } from '@/store/prefsStore';
import {
  Button,
  ConfirmDialog,
  HowItWorksList,
  IconCheck,
  IconChevronRight,
  IconInfo,
  IconLock,
  IconMail,
  IconStar,
  Input,
  LanguagePickerSheet,
  ListItem,
  RawText,
  Sheet,
  Toggle,
} from '@/ui';

// Reminder-window time helpers. Windows store 24h 'HH:mm' local wall-clock
// strings (03 §notification_prefs); the scheduler fires them ±30min in the
// profile timezone. The Date round-trip uses a fixed dummy day so only the
// hour/minute fields ever matter (no DST sensitivity).
const FALLBACK_WINDOW = '19:00'; // mirrors the server-side default
function parseHHMM(s: string): { h: number; m: number } {
  const [h = 0, m = 0] = s.split(':').map(Number);
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}
function hhmmToDate(s: string): Date {
  const { h, m } = parseHHMM(s);
  return new Date(2000, 0, 1, h, m);
}
function dateToHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function formatReminderTime(hhmm: string): string {
  const { h, m } = parseHHMM(hhmm);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

const QUIZ_OPTIONS = [
  { n: 20, min: 2, max: 7, labelKey: 'quizLabelQuick' },
  { n: 40, min: 3, max: 14, labelKey: 'quizLabelStandard' },
  { n: 60, min: 5, max: 20, labelKey: 'quizLabelExtended' },
  { n: 80, min: 7, max: 27, labelKey: 'quizLabelDeep' },
  { n: 100, min: 8, max: 33, labelKey: 'quizLabelMarathon' },
] as const;
const QUIZ_RECOMMENDED = 40;

// ── Premium gate callout ────────────────────────────────────────────────────
function PremiumGate({ title, body, onUpgrade }: { title: string; body: string; onUpgrade: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.gate}>
      <View style={styles.gateText}>
        <RawText style={styles.gateTitle}>{title}</RawText>
        <RawText style={styles.gateBody}>{body}</RawText>
      </View>
      <Pressable onPress={onUpgrade} style={({ pressed }) => [styles.gateBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        <RawText style={styles.gateBtnText}>{t('settings.upgrade')}</RawText>
      </Pressable>
    </View>
  );
}

// ── SE-01 Edit Profile ────────────────────────────────────────────────────────
export function EditProfileSheet({ visible, profile, isPaid, onClose, onUpgrade }: { visible: boolean; profile: Profile | undefined; isPaid: boolean; onClose: () => void; onUpgrade: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [learning, setLearning] = useState<string>(profile?.targetLang ?? 'es');
  const [picker, setPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const nativeLang = profile?.nativeLang ?? 'en';
  const learningLabel = findLanguage(learning)?.name ?? languageName(learning as LanguageCode);
  // Learning target can be any translatable language except the user's native one.
  const targetLanguages = useMemo(() => TRANSLATABLE_LANGUAGES.filter((l) => l.code.toLowerCase() !== nativeLang.toLowerCase()), [nativeLang]);

  return (
    <>
      <Sheet visible={visible && !picker} onClose={onClose} title={t('settings.editProfileTitle')}>
        <FieldLabel>{t('settings.displayName')}</FieldLabel>
        <Input placeholder={t('settings.displayNamePlaceholder')} value={name} onChangeText={setName} />

        <FieldLabel>{t('settings.nativeLanguage')}</FieldLabel>
        <ReadOnlyField value={languageName((profile?.nativeLang ?? 'en') as LanguageCode)} note={t('settings.nativeNote')} />

        <FieldLabel>{t('settings.learningLanguage')}</FieldLabel>
        {isPaid ? (
          <Pressable onPress={() => setPicker(true)} style={({ pressed }) => [styles.fieldRow, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <RawText style={styles.fieldValue}>{learningLabel}</RawText>
            <RawText style={styles.fieldChange}>{t('settings.changeLang')}</RawText>
          </Pressable>
        ) : (
          <>
            <View style={styles.fieldLocked}>
              <RawText style={styles.fieldValueMuted}>{learningLabel}</RawText>
              <IconLock size={13} color={theme.color.textMuted} />
            </View>
            <PremiumGate title={t('settings.langMultiTitle')} body={t('settings.langMultiBody')} onUpgrade={onUpgrade} />
          </>
        )}

        <View style={styles.saveWrap}>
          <Button title={t('settings.saveChanges')} variant="primary" onPress={onClose} />
        </View>
        <Pressable onPress={() => setConfirmDelete(true)} style={({ pressed }) => [styles.deleteRow, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <RawText style={styles.deleteText}>{t('settings.deleteAccount')}</RawText>
        </Pressable>
      </Sheet>

      <LanguagePickerSheet
        visible={visible && picker}
        current={learning}
        languages={targetLanguages}
        title={t('settings.langPickerTitle')}
        searchPlaceholder={t('settings.searchLanguages')}
        onSelect={(c) => { setLearning(c); setPicker(false); }}
        onClose={() => setPicker(false)}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title={t('settings.deleteAccountTitle')}
        body={`${t('settings.deleteAccountBody')}\n\n${t('settings.deleteAccountWarn')}`}
        confirmLabel={t('settings.deleteConfirm')}
        cancelLabel={t('settings.cancel')}
        destructive
        onConfirm={() => { setConfirmDelete(false); onClose(); }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}

// ── SE-02 Study Reminders ───────────────────────────────────────────────────
// Wired to DataSource notification prefs (2.5 app half). The draft mirrors the
// 03 shape — enabled + windows — which is what the server-side pg_cron
// scheduler actually reads; there is no days-of-week concept, so the old
// (local-state-only) weekday chips are gone. The UI also deliberately offers
// NO frequency selector: run_push_scheduler() caps at one push per user per
// local day (push_log dedupe), so a second window can never fire — offering
// "twice daily" would save but silently not deliver. If that cap is ever
// relaxed to per-window dedupe (backlog), add the selector back here. The
// stored frequency and any extra windows round-trip untouched; the UI edits
// windows[0] only.
export function NotificationSheet({ visible, isPaid, onClose, onUpgrade }: { visible: boolean; isPaid: boolean; onClose: () => void; onUpgrade: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { prefs } = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();

  const [enabled, setEnabled] = useState(true);
  const [windows, setWindows] = useState<{ time: string }[]>([{ time: FALLBACK_WINDOW }]);
  const [editing, setEditing] = useState<number | null>(null); // window index open in the native picker
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [seededFor, setSeededFor] = useState<NotificationPrefs | null>(null);

  // Seed the draft from server prefs once per open (or when prefs land just
  // after opening) — the same render-phase "adjust state during render"
  // pattern Sheet uses. Deliberately once per open: mid-edit background
  // refetches must not clobber the user's unsaved changes.
  if (!visible && seededFor != null) setSeededFor(null);
  if (visible && prefs != null && seededFor == null) {
    setSeededFor(prefs);
    setEnabled(prefs.enabled);
    setWindows(prefs.windows.length > 0 ? prefs.windows : [{ time: FALLBACK_WINDOW }]);
    setEditing(null);
    setSaveAttempted(false); // a previous open's failed save shouldn't show stale
  }

  const setTime = (idx: number, time: string) => setWindows((w) => w.map((win, i) => (i === idx ? { time } : win)));

  const save = () => {
    setSaveAttempted(true);
    // Free users only control the on/off switch — send a partial so their
    // stored windows are never clobbered by the locked draft. Paid saves the
    // full windows array (only [0] is editable; extras round-trip untouched).
    const patch: Partial<NotificationPrefs> = isPaid ? { enabled, windows } : { enabled };
    update.mutate(patch, {
      onSuccess: () => {
        // Opting in from Settings registers the device push token (push.ts
        // contract: call after explicit opt-in, never unprompted). Fire-and-
        // forget — a denied OS prompt must not block saving prefs.
        if (enabled) void registerForPush().catch(() => {});
        onClose();
      },
    });
  };

  const primaryTime = windows[0]?.time ?? FALLBACK_WINDOW;
  const iosPickerOpen = editing != null && Platform.OS === 'ios';

  return (
    <>
    <Sheet visible={visible && !iosPickerOpen} onClose={onClose} title={t('settings.notifTitle')}>
      <View style={styles.notifToggle}>
        <View style={styles.flex1}>
          <RawText style={styles.notifToggleTitle}>{t('settings.enableReminders')}</RawText>
          <RawText style={styles.notifToggleSub}>{t('settings.enableRemindersSub')}</RawText>
        </View>
        <Toggle value={enabled} onValueChange={setEnabled} />
      </View>

      <View style={{ opacity: enabled ? 1 : 0.4 }} pointerEvents={enabled ? 'auto' : 'none'}>
        <FieldLabel>{t('settings.reminderTime')}</FieldLabel>
        {isPaid ? (
          <Pressable onPress={() => setEditing(0)} style={({ pressed }) => [styles.timeRow, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t('settings.reminderTime')}>
            <RawText style={[styles.timeText, { color: theme.color.textStrong }]}>{formatReminderTime(primaryTime)}</RawText>
            <View style={styles.timeChange}>
              <RawText style={styles.fieldChange}>{t('settings.changeTime')}</RawText>
              <IconChevronRight size={14} color={theme.color.brand} />
            </View>
          </Pressable>
        ) : (
          <View style={styles.timeRow}>
            <RawText style={styles.timeText}>{formatReminderTime(primaryTime)}</RawText>
            <IconLock size={14} color={theme.color.textMuted} />
          </View>
        )}

        {!isPaid && <PremiumGate title={t('settings.customTimeTitle')} body={t('settings.customTimeBody')} onUpgrade={onUpgrade} />}
      </View>

      {saveAttempted && update.isError && <RawText style={styles.saveError}>{t('settings.saveError')}</RawText>}
      <View style={styles.saveWrap}>
        <Button title={t('settings.savePreferences')} variant="primary" disabled={update.isPending || prefs == null} onPress={save} />
      </View>
    </Sheet>

    {/* Native time picker. Android: the system clock dialog (mounting shows it);
        iOS: the native spinner stacked in its own sheet, matching the existing
        sheet-over-sheet pattern. */}
    {editing != null && Platform.OS === 'android' && (
      <DateTimePicker
        mode="time"
        value={hhmmToDate(windows[editing]?.time ?? FALLBACK_WINDOW)}
        onValueChange={(_e: DateTimePickerChangeEvent, d: Date) => {
          const idx = editing;
          setEditing(null); // close FIRST — Android fires exactly once per open; this guards re-entry
          if (idx != null) setTime(idx, dateToHHMM(d));
        }}
        onDismiss={() => setEditing(null)}
      />
    )}
    {editing != null && Platform.OS === 'ios' && (
      <Sheet visible onClose={() => setEditing(null)} title={t('settings.timePickerTitle')}>
        <View style={styles.iosPickerWrap}>
          <DateTimePicker
            mode="time"
            display="spinner"
            value={hhmmToDate(windows[editing]?.time ?? FALLBACK_WINDOW)}
            onValueChange={(_e: DateTimePickerChangeEvent, d: Date) => {
              if (editing != null) setTime(editing, dateToHHMM(d));
            }}
          />
        </View>
        <View style={styles.saveWrap}>
          <Button title={t('common.done')} variant="primary" onPress={() => setEditing(null)} />
        </View>
      </Sheet>
    )}
    </>
  );
}

// ── SE-03 Quiz Length ────────────────────────────────────────────────────────
// One persisted source of truth (17 §S2/X4): the prefsStore `quizLength`, read by
// this sheet, the Settings row subtitle, and QuizScreen's session slice. Free tier
// is pinned to QUIZ_LENGTH_FREE (20 — short sessions protect the daily habit).
export function QuizLengthSheet({ visible, isPaid, onClose, onUpgrade }: { visible: boolean; isPaid: boolean; onClose: () => void; onUpgrade: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const quizLength = usePrefsStore((s) => s.quizLength);
  const setQuizLength = usePrefsStore((s) => s.setQuizLength);
  const [selected, setSelected] = useState(isPaid ? quizLength : QUIZ_LENGTH_FREE);
  // Re-seed the draft each open so a canceled edit doesn't linger (render-adjust
  // pattern, same as NotificationSheet).
  const [seededOpen, setSeededOpen] = useState(false);
  if (!visible && seededOpen) setSeededOpen(false);
  if (visible && !seededOpen) {
    setSeededOpen(true);
    setSelected(isPaid ? quizLength : QUIZ_LENGTH_FREE);
  }

  const save = () => {
    setQuizLength(selected);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('settings.quizTitle')}>
      <RawText style={styles.quizIntro}>{t('settings.quizInfo')}</RawText>
      {!isPaid && <PremiumGate title={t('settings.quizCustomizeTitle')} body={t('settings.quizCustomizeBody')} onUpgrade={onUpgrade} />}
      <View style={{ opacity: isPaid ? 1 : 0.45, marginTop: 4 }} pointerEvents={isPaid ? 'auto' : 'none'}>
        {QUIZ_OPTIONS.map((o) => {
          const sel = selected === o.n;
          return (
            <Pressable key={o.n} onPress={() => setSelected(o.n)} style={[styles.quizOption, { borderColor: sel ? theme.color.brand : theme.color.border, backgroundColor: sel ? theme.color.brandTint : 'transparent' }]} accessibilityRole="radio" accessibilityState={{ selected: sel }}>
              <View style={styles.quizOptionText}>
                <RawText style={[styles.quizN, { color: sel ? theme.color.brand : theme.color.textStrong }]}>{t('settings.quizCards', { count: o.n })}</RawText>
                <RawText style={styles.quizRange}>{t('settings.quizRange', { min: o.min, max: o.max })}</RawText>
                <RawText style={styles.quizLabel}>· {t(`settings.${o.labelKey}`)}</RawText>
                {o.n === QUIZ_RECOMMENDED && (
                  <View style={styles.recommendedBadge}>
                    <RawText style={styles.recommendedText}>{t('settings.quizRecommended')}</RawText>
                  </View>
                )}
              </View>
              {sel && <IconCheck size={16} color={theme.color.brand} />}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.saveWrap}>
        {isPaid ? (
          <Button title={t('settings.quizSave')} variant="primary" onPress={save} />
        ) : (
          <Button title={t('settings.upgradeToPremium')} variant="primary" onPress={onUpgrade} />
        )}
      </View>
    </Sheet>
  );
}

// ── How Lexicamp works (17 §H3) — the Home educator content, permanently reachable
// here after the Home card is dismissed. Same shared accordion component.
export function HowItWorksSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('home.edu.title')}>
      <RawText style={styles.quizIntro}>{t('home.edu.teaser')}</RawText>
      <HowItWorksList />
    </Sheet>
  );
}

// ── SE-07 Support ──────────────────────────────────────────────────────────────
export function SupportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const rows = [
    { icon: <IconMail size={20} color={theme.color.brand} />, label: t('settings.emailSupport'), addr: t('settings.emailSupportAddr'), desc: t('settings.emailSupportDesc') },
    { icon: <IconInfo size={20} color={theme.color.brand} />, label: t('settings.helpCenter'), addr: t('settings.helpCenterAddr'), desc: t('settings.helpCenterDesc') },
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={t('settings.supportTitle')}>
      <View style={styles.supportList}>
        {rows.map((r) => (
          <View key={r.label} style={styles.supportRow}>
            <View style={styles.supportIcon}>{r.icon}</View>
            <View style={styles.flex1}>
              <RawText style={styles.supportLabel}>{r.label}</RawText>
              <RawText style={styles.supportAddr}>{r.addr}</RawText>
              <RawText style={styles.supportDesc}>{r.desc}</RawText>
            </View>
          </View>
        ))}
        <View style={styles.supportNote}>
          <RawText style={styles.supportNoteText}>{t('settings.billingNote')}</RawText>
        </View>
      </View>
    </Sheet>
  );
}

// ── SE-08 About ────────────────────────────────────────────────────────────────
export function AboutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('settings.aboutTitle')}>
      <View style={styles.aboutHead}>
        <IconStar size={40} color={theme.color.accent} />
        <RawText style={styles.aboutName}>Lexicamp</RawText>
        <RawText style={styles.aboutTagline}>{t('settings.aboutTagline')}</RawText>
        <RawText style={styles.aboutVersion}>{t('settings.aboutVersion', { version: '1.0.0', build: 1 })}</RawText>
      </View>
      <View style={styles.aboutLinks}>
        {[t('settings.terms'), t('settings.privacy'), t('settings.acknowledgments')].map((label, i, arr) => (
          <ListItem key={label} title={label} onPress={() => {}} last={i === arr.length - 1} />
        ))}
      </View>
      <RawText style={styles.aboutCopyright}>{t('settings.aboutCopyright')}{'\n'}{t('settings.aboutMadeWith')}</RawText>
    </Sheet>
  );
}

// ── Small shared field bits ─────────────────────────────────────────────────
function FieldLabel({ children }: { children: ReactNode }) {
  return <RawText style={styles.fieldLabel}>{children}</RawText>;
}
function ReadOnlyField({ value, note }: { value: string; note?: string }) {
  return (
    <View style={styles.readOnlyWrap}>
      <View style={styles.readOnly}>
        <RawText style={styles.readOnlyValue}>{value}</RawText>
      </View>
      {note != null && <RawText style={styles.readOnlyNote}>{note}</RawText>}
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, radius, palette } = theme;
  return {
    flex1: { flex: 1 },
    fieldLabel: { fontFamily: fonts.sans.semibold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted, marginBottom: 6, marginTop: 4 },

    readOnlyWrap: { marginBottom: 16 },
    readOnly: { paddingVertical: 11, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surfaceSunken },
    readOnlyValue: { fontFamily: fonts.sans.regular, fontSize: 15, color: color.textMuted },
    readOnlyNote: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textFaint, marginTop: 4 },

    fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, marginBottom: 8 },
    fieldValue: { fontFamily: fonts.sans.medium, fontSize: 15, color: color.textStrong },
    fieldChange: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.brand },
    fieldLocked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surfaceSunken, marginBottom: 10 },
    fieldValueMuted: { fontFamily: fonts.sans.regular, fontSize: 15, color: color.textMuted },

    saveWrap: { marginTop: 16 },
    deleteRow: { marginTop: 14, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.dangerSoft, alignItems: 'center' },
    deleteText: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.danger },

    // premium gate
    gate: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.amber[50], borderWidth: theme.borderWidth.thin, borderColor: palette.amber[200], borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 16 },
    gateText: { flex: 1 },
    gateTitle: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.textStrong, marginBottom: 1 },
    gateBody: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted },
    gateBtn: { backgroundColor: color.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    gateBtnText: { fontFamily: fonts.sans.bold, fontSize: 12, color: color.textOnAccent },

    // notifications
    notifToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: color.surfaceSunken, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 20 },
    notifToggleTitle: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong },
    notifToggleSub: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted },
    timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surfaceSunken, marginBottom: 16 },
    timeText: { fontFamily: fonts.sans.bold, fontSize: 18, color: color.textMuted },
    timeChange: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    saveError: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.danger, marginTop: 12 },
    iosPickerWrap: { alignItems: 'center' },

    // quiz length
    quizIntro: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted, marginBottom: 14 },
    quizOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1.5, marginBottom: 6 },
    quizOptionText: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    quizN: { fontFamily: fonts.sans.bold, fontSize: 16 },
    quizRange: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted },
    quizLabel: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textFaint },
    recommendedBadge: { backgroundColor: color.evergreenTint, borderWidth: theme.borderWidth.thin, borderColor: color.evergreenSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
    recommendedText: { fontFamily: fonts.sans.bold, fontSize: 10, color: color.evergreen },

    // support
    supportList: { gap: 10 },
    supportRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surfaceSunken },
    supportIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: color.brandSoft, alignItems: 'center', justifyContent: 'center' },
    supportLabel: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong },
    supportAddr: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.brand, marginTop: 2 },
    supportDesc: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 1 },
    supportNote: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: theme.borderWidth.thin, borderColor: color.border, backgroundColor: color.surfaceSunken },
    supportNoteText: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted },

    // about
    aboutHead: { alignItems: 'center', paddingBottom: 18 },
    aboutName: { fontFamily: fonts.sans.extra, fontSize: 20, letterSpacing: -0.4, color: color.textStrong, marginTop: 8 },
    aboutTagline: { fontFamily: fonts.serif.semibold, fontSize: 14, color: color.textMuted, textAlign: 'center', marginTop: 4 },
    aboutVersion: { fontFamily: fonts.mono.regular, fontSize: 12, color: color.textMuted, marginTop: 6 },
    aboutLinks: {},
    aboutCopyright: { fontFamily: fonts.sans.regular, fontSize: 12, lineHeight: 18, color: color.textFaint, textAlign: 'center', marginTop: 14 },
  };
});
