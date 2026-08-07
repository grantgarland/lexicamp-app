// Settings deep-editor sheets (SE-01…SE-08), assembled against settings/Settings.html.
// Each is a shared-kit `Sheet`; premium-gated editors surface a `PremiumGate` callout
// that routes to the paywall via `onUpgrade`. Kept in their own module so SettingsScreen
// stays a thin hub.
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { type ReactNode, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SvgXml } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { languageName } from '@/domain/derive';
import { useIsDark } from '@/theme/appearance';
import type { LanguageCode, NotificationPrefs, Profile } from '@/domain/types';
import { formatUsername, generateUsernameCandidate } from '@/domain/username';
import { useTranslation } from '@/i18n';
import { signOut } from '@/auth/session';
import { dataSource } from '@/data';
import { registerForPush } from '@/notifications/push';
import { LEGAL_URLS, SUPPORT_EMAIL, SUPPORT_URLS } from '@/constants/legal';
import { appVersionLabel } from '@/constants/appInfo';
import { BRAND_MARK_KNOCKOUT_XML, BRAND_MARK_XML } from '@/ui/brandMark';
import { useAccountIdentity, useNotificationPrefs, useSetUsername, useUpdateNotificationPrefs, useUpdateProfile } from '@/query/hooks';
import { APPEARANCE_MODES, useAppearanceStore } from '@/store/appearanceStore';
import { QUIZ_LENGTH_FREE, usePrefsStore } from '@/store/prefsStore';
import { useUiStore } from '@/store/uiStore';
import {
  Button,
  ConfirmDialog,
  HowItWorksList,
  IconCheck,
  IconChevronRight,
  IconInfo,
  IconLock,
  IconMail,
  IconMonitor,
  IconMoon,
  IconRefresh,
  IconSun,
  ListItem,
  RawText,
  Sheet,
  Toggle,
} from '@/ui';

// Reminder-window time helpers. Windows store 24h 'HH:mm' local wall-clock
// strings (03 §notification_prefs); the scheduler fires them ±30min in the
// profile timezone. The Date round-trip uses a fixed dummy day so only the
// hour/minute fields ever matter (no DST sensitivity).
const FALLBACK_WINDOW = '09:00'; // mirrors the server-side default (Casey 2026-07-22: 7pm -> 9am)
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
/** C3: reminder times step in 15-min increments. iOS enforces via minuteInterval;
 *  Android's clock dialog can't, so the picked value rounds to the nearest step
 *  (rolling over midnight safely via Date math). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function roundToQuarterHour(d: Date): Date {
  const r = new Date(d);
  r.setMinutes(Math.round(r.getMinutes() / 15) * 15, 0, 0);
  return r;
}
export function formatReminderTime(hhmm: string): string {
  const { h, m } = parseHHMM(hhmm);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// Doubling ladder (Casey, 2026-07-16): 10 / 20 / 40 / 80. 20 = Standard, the
// recommended default AND the free-tier pin — free users study the recommended
// experience, premium tunes around it. (Supersedes D5's 10–100 six-option set.)
// Minute ranges derive from the stated ~2–20 s/card (quizInfo copy) — keep in sync.
const QUIZ_OPTIONS = [
  { n: 10, min: 1, max: 3, labelKey: 'quizLabelQuick' },
  { n: 20, min: 1, max: 7, labelKey: 'quizLabelStandard' },
  { n: 40, min: 2, max: 13, labelKey: 'quizLabelExtended' },
  { n: 80, min: 3, max: 27, labelKey: 'quizLabelMarathon' },
] as const;
const QUIZ_RECOMMENDED = 20;

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
// 20 §3 v2 (R5: reroll-only identity, cycle/save split — Casey 2026-07-22):
// read-only Account block (email + auth provider), the username CYCLER
// (candidates draft locally from the official word lists; "New name" never
// writes), a dirty-gated Save (the ONLY write — set_username re-validates
// list membership server-side, so free-form names are impossible), the
// read-only native language, and delete account.
//
// Tier rules (server-enforced, UI-mirrored):
//   free, 0 changes  → cycle + Save; Save opens a one-free-change confirm sheet
//   free, ≥1 change  → cycler replaced by the PremiumGate callout
//   premium          → cycle + Save directly; 20/day cap surfaces reactively
//                      (rate_limited → cycler disables until reopen/tomorrow)
export function EditProfileSheet({ visible, profile, isPaid, onClose, onUpgrade }: { visible: boolean; profile: Profile | undefined; isPaid: boolean; onClose: () => void; onUpgrade: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const showToast = useUiStore((s) => s.showToast);
  const identity = useAccountIdentity();
  const setUsername = useSetUsername();
  const current = profile?.username ?? '';
  const changesUsed = profile?.usernameChanges ?? 0;
  const [draft, setDraft] = useState(current);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmFreeChange, setConfirmFreeChange] = useState(false);
  // Premium 20/day cap is discovered reactively (a rate_limited save) — the
  // cycler then disables like the free post-limit state until the next open.
  const [rateLimited, setRateLimited] = useState(false);

  // Re-seed the draft each open (render-adjust, same as NotificationSheet) so
  // dirty-gating compares against current profile state, not stale edits.
  const [seededOpen, setSeededOpen] = useState(false);
  if (!visible && seededOpen) setSeededOpen(false);
  if (visible && !seededOpen) {
    setSeededOpen(true);
    setDraft(current);
    setConfirmFreeChange(false);
    setRateLimited(false);
  }

  const dirty = draft !== current && draft !== '';
  const canCycle = !rateLimited && (isPaid || changesUsed === 0);

  const cycle = () => setDraft(generateUsernameCandidate(Math.random, draft));

  const commit = () => {
    setConfirmFreeChange(false);
    setUsername.mutate(draft, {
      onSuccess: () => {
        showToast({ variant: 'success', message: t('settings.profileSaved') });
        onClose();
      },
      onError: (e) => {
        // Informative failure paths (Casey 2026-07-22) — every token gets its
        // own actionable copy; the optimistic update already rolled back.
        const token = e instanceof Error ? e.message : '';
        if (token === 'username_taken') {
          // The drafted name was claimed between cycle and save — rare race;
          // the sheet stays open so the user just cycles again.
          showToast({ variant: 'destructive', message: t('settings.usernameTakenToast') });
        } else if (token === 'username_change_limit') {
          // Stale local state (limit already spent elsewhere) — the profile
          // refetch (onSettled) flips this sheet to the PremiumGate.
          showToast({ variant: 'destructive', message: t('settings.usernameChangeLimitToast') });
        } else if (token === 'rate_limited') {
          setRateLimited(true);
          showToast({ variant: 'destructive', message: t('settings.usernameRateLimited') });
        } else {
          showToast({ variant: 'destructive', message: t('settings.saveError') });
        }
      },
    });
  };

  const save = () => {
    // Free tier: the one-change warning sheet stands between Save and commit
    // (premium saves directly — no interstitial).
    if (!isPaid) setConfirmFreeChange(true);
    else commit();
  };

  return (
    <>
      <Sheet visible={visible && !confirmFreeChange} onClose={onClose} title={t('settings.editProfileTitle')}>
        <FieldLabel>{t('settings.accountField')}</FieldLabel>
        <ReadOnlyField
          value={identity?.email ?? '…'}
          note={t(identity?.provider === 'apple' ? 'settings.providerApple' : 'settings.providerEmail')}
        />

        <FieldLabel>{t('settings.username')}</FieldLabel>
        <View style={[styles.usernameBox, dirty && { borderColor: theme.color.brand }]}>
          <RawText style={styles.usernameValue} numberOfLines={1}>{formatUsername(draft)}</RawText>
          {canCycle && (
            <Pressable
              onPress={cycle}
              accessibilityRole="button"
              accessibilityLabel={t('settings.usernameCycle')}
              accessibilityHint={t('settings.usernameCycleHint')}
              hitSlop={8}
              style={({ pressed }) => [styles.cycleBtn, pressed && { opacity: 0.6 }]}
            >
              <IconRefresh size={18} color={theme.color.brand} />
            </Pressable>
          )}
        </View>
        <RawText style={styles.usernameNote}>
          {rateLimited
            ? t('settings.usernameRateLimitedHint')
            : dirty
              ? t('settings.usernameDirtyHint')
              : t('settings.usernameNote')}
        </RawText>
        {/* Free tier with the single change spent: the cycler is gone; the
            gate explains why and routes to the paywall (Casey: "tooltip
            indicating that creating a new username is a Premium feature"). */}
        {!isPaid && changesUsed >= 1 && (
          <PremiumGate title={t('settings.usernameGateTitle')} body={t('settings.usernameGateBody')} onUpgrade={onUpgrade} />
        )}

        <FieldLabel>{t('settings.nativeLanguage')}</FieldLabel>
        <ReadOnlyField value={languageName((profile?.nativeLang ?? 'en') as LanguageCode)} note={t('settings.nativeNote')} />

        {/* Appearance (2026-08-04). Deliberately NOT dirty-gated behind Save:
            the whole value of an appearance switch is seeing it, so it applies
            the instant it is tapped and persists itself. */}
        <FieldLabel>{t('settings.appearance')}</FieldLabel>
        <AppearancePicker />

        <View style={styles.saveWrap}>
          <Button title={t('settings.save')} variant="primary" disabled={!dirty || !canCycle || setUsername.isPending} onPress={save} />
        </View>
        <Pressable testID="settingsDeleteAccount" onPress={() => setConfirmDelete(true)} style={({ pressed }) => [styles.deleteRow, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <RawText style={styles.deleteText}>{t('settings.deleteAccount')}</RawText>
        </Pressable>
      </Sheet>

      {/* Free-tier one-change confirmation (stacked sheet, same pattern as the
          iOS time picker): honest UI — the user learns the cost BEFORE the
          change is spent, with a no-harm way back to cycling. */}
      <Sheet visible={visible && confirmFreeChange} onClose={() => setConfirmFreeChange(false)} title={t('settings.usernameConfirmTitle')}>
        <RawText style={styles.confirmName}>{formatUsername(draft)}</RawText>
        <RawText style={styles.confirmBody}>{t('settings.usernameConfirmBody')}</RawText>
        <View style={styles.saveWrap}>
          <Button title={t('settings.usernameConfirmCta')} variant="primary" disabled={setUsername.isPending} onPress={commit} />
        </View>
        <View style={styles.confirmCancelWrap}>
          <Button title={t('settings.usernameConfirmCancel')} variant="secondary" onPress={() => setConfirmFreeChange(false)} />
        </View>
      </Sheet>

      <ConfirmDialog
        visible={confirmDelete}
        title={t('settings.deleteAccountTitle')}
        body={`${t('settings.deleteAccountBody')}\n\n${t('settings.deleteAccountWarn')}`}
        confirmLabel={t('settings.deleteConfirm')}
        cancelLabel={t('settings.cancel')}
        destructive
        // Type-to-confirm: `delete_own_account` has no undo and no recovery
        // window, so a single destructive tap is not enough friction.
        //
        // A short LOCALIZED word, not the account email — Sign in with Apple
        // hands out relay addresses like `a1b2c3d4e5@privaterelay.appleid.com`,
        // and demanding that be typed on a phone keyboard turns a legitimate
        // deletion into a chore (and pushes users to support instead).
        //
        // The word is read from the locale file and passed to the dialog, which
        // compares against THAT string and renders it in the prompt from the
        // same value. A translator can change 'delete' to anything without
        // touching code — nothing here compares to a hardcoded constant.
        typeToConfirm={{
          word: t('settings.deleteAccountConfirmWord'),
          label: t('settings.deleteAccountConfirmLabel', { word: t('settings.deleteAccountConfirmWord') }),
          placeholder: t('settings.deleteAccountConfirmPlaceholder', { word: t('settings.deleteAccountConfirmWord') }),
        }}
        onConfirm={() => {
          if (deleting) return;
          setDeleting(true);
          void (async () => {
            try {
              await dataSource.deleteOwnAccount();
            } catch {
              // Surface and BAIL — signing out after a failed delete would hide
              // the fact that the account still exists.
              setDeleting(false);
              setConfirmDelete(false);
              showToast({ variant: 'warning', message: t('settings.deleteFailed') });
              return;
            }
            // Row is gone; the cached JWT is now worthless. Sign out to clear it,
            // then the tabs session guard bounces to /onboarding on its own.
            await signOut().catch(() => {});
            setDeleting(false);
            setConfirmDelete(false);
            onClose();
          })();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}

// ── SE-02 Study Reminders ───────────────────────────────────────────────────
// Wired to DataSource notification prefs. Draft mirrors the 03 shape — enabled +
// windows + days — which the server-side pg_cron scheduler reads. Weekday chips
// RETURNED in Phase C (18 §C1/C2) now that the scheduler honestly honors them
// (they were removed in 2.5 as local-state fiction). Still NO frequency selector:
// the scheduler caps at one push per user per local day. Free tier: on/off only;
// time + days are premium (D2). Save is dirty-gated and toasts on success (C4).
export function NotificationSheet({ visible, isPaid, onClose, onUpgrade }: { visible: boolean; isPaid: boolean; onClose: () => void; onUpgrade: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { prefs } = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const showToast = useUiStore((s) => s.showToast);

  const [enabled, setEnabled] = useState(true);
  const [windows, setWindows] = useState<{ time: string }[]>([{ time: FALLBACK_WINDOW }]);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [editing, setEditing] = useState<number | null>(null); // window index open in the native picker
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [seededFor, setSeededFor] = useState<NotificationPrefs | null>(null);
  // UX-17d: honest UI — if reminders are ON here but the OS permission is
  // denied, no push can ever arrive. Probe on each open (the user may return
  // from system settings) and surface the fix.
  const [osBlocked, setOsBlocked] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    Notifications.getPermissionsAsync()
      .then((p) => {
        if (alive) setOsBlocked(!p.granted && !p.canAskAgain);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [visible]);

  // Seed the draft from server prefs once per open (or when prefs land just
  // after opening) — the same render-phase "adjust state during render"
  // pattern Sheet uses. Deliberately once per open: mid-edit background
  // refetches must not clobber the user's unsaved changes.
  if (!visible && seededFor != null) setSeededFor(null);
  if (visible && prefs != null && seededFor == null) {
    setSeededFor(prefs);
    setEnabled(prefs.enabled);
    setWindows(prefs.windows.length > 0 ? prefs.windows : [{ time: FALLBACK_WINDOW }]);
    setDays(prefs.days.length > 0 ? [...prefs.days].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6]);
    setEditing(null);
    setSaveAttempted(false); // a previous open's failed save shouldn't show stale
  }

  const setTime = (idx: number, time: string) => setWindows((w) => w.map((win, i) => (i === idx ? { time } : win)));
  const toggleDay = (d: number) =>
    setDays((cur) => {
      if (cur.includes(d)) {
        // Never allow an empty selection — the server constraint rejects it, and
        // "reminders on but zero days" would be silently-off dishonest UI.
        if (cur.length === 1) return cur;
        return cur.filter((x) => x !== d);
      }
      return [...cur, d].sort((a, b) => a - b);
    });

  // C4: dirty-gating — Save only lights up when the draft differs from the
  // server state (free users can only dirty the toggle).
  const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  const dirty =
    prefs != null &&
    (enabled !== prefs.enabled ||
      (isPaid &&
        ((windows[0]?.time ?? FALLBACK_WINDOW) !== (prefs.windows[0]?.time ?? FALLBACK_WINDOW) ||
          !sameDays(days, [...prefs.days].sort((a, b) => a - b)))));

  const save = () => {
    setSaveAttempted(true);
    // Free users only control the on/off switch — send a partial so their
    // stored windows/days are never clobbered by the locked draft. Paid saves
    // windows (only [0] editable; extras round-trip untouched) + days.
    const patch: Partial<NotificationPrefs> = isPaid ? { enabled, windows, days } : { enabled };
    update.mutate(patch, {
      onSuccess: () => {
        // Opting in from Settings registers the device push token (push.ts
        // contract: call after explicit opt-in, never unprompted). Fire-and-
        // forget — a denied OS prompt must not block saving prefs.
        if (enabled) void registerForPush().catch(() => {});
        showToast({ variant: 'success', message: t('settings.prefsSaved') });
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

      {/* UX-17d: permission-denied hint — shown only when it matters. */}
      {enabled && osBlocked && (
        <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button" style={({ pressed }) => [styles.osBlocked, pressed && { opacity: 0.8 }]}>
          <RawText style={styles.osBlockedText}>{t('settings.notifOsBlocked')}</RawText>
          <RawText style={styles.osBlockedLink}>{t('settings.notifOpenSettings')}</RawText>
        </Pressable>
      )}

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
          // D12: free users see the DEFAULT that actually fires — their stored
          // premium-era time is preserved server-side but not honored.
          <View style={styles.timeRow}>
            <RawText style={styles.timeText}>{formatReminderTime(FALLBACK_WINDOW)}</RawText>
            <IconLock size={14} color={theme.color.textMuted} />
          </View>
        )}

        {/* C2: weekday selection (dow 0=Sun..6=Sat) — premium; the scheduler
            now honors it server-side. At least one day always stays on. */}
        <FieldLabel>{t('settings.reminderDays')}</FieldLabel>
        <View style={styles.dayRow}>
          {(t('settings.daysShort', { returnObjects: true }) as string[]).map((label, d) => {
            // D12: free tier fires every day — show that, not stored premium-era days.
            const on = isPaid ? days.includes(d) : true;
            return (
              <Pressable
                key={d}
                disabled={!isPaid}
                onPress={() => toggleDay(d)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !isPaid }}
                accessibilityLabel={(t('date.days', { returnObjects: true }) as string[])[d]}
                style={[
                  styles.dayChip,
                  { backgroundColor: on ? theme.color.brand : theme.color.surfaceSunken, borderColor: on ? theme.color.brand : theme.color.border },
                  !isPaid && { opacity: 0.45 },
                ]}
              >
                <RawText style={[styles.dayChipText, { color: on ? '#fff' : theme.color.textMuted }]}>{label}</RawText>
              </Pressable>
            );
          })}
        </View>

        {!isPaid && <PremiumGate title={t('settings.customTimeTitle')} body={t('settings.customTimeBody')} onUpgrade={onUpgrade} />}
      </View>

      {saveAttempted && update.isError && <RawText style={styles.saveError}>{t('settings.saveError')}</RawText>}
      <View style={styles.saveWrap}>
        <Button title={t('settings.save')} variant="primary" disabled={!dirty || update.isPending || prefs == null} onPress={save} />
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
            minuteInterval={15}
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
  const showToast = useUiStore((s) => s.showToast);
  const [selected, setSelected] = useState(isPaid ? quizLength : QUIZ_LENGTH_FREE);
  // Re-seed the draft each open so a canceled edit doesn't linger (render-adjust
  // pattern, same as NotificationSheet).
  const [seededOpen, setSeededOpen] = useState(false);
  if (!visible && seededOpen) setSeededOpen(false);
  if (visible && !seededOpen) {
    setSeededOpen(true);
    setSelected(isPaid ? quizLength : QUIZ_LENGTH_FREE);
  }

  // C4 pattern (Casey follow-up): Save stays disabled until the choice changed.
  const dirty = isPaid && selected !== quizLength;

  // UX-17b: local pref is the read model; the profile mirror makes it survive
  // reinstalls + sync across devices (write-through; server adopts via
  // useQuizLengthSync on other devices).
  const updateProfile = useUpdateProfile();
  const save = () => {
    setQuizLength(selected);
    updateProfile.mutate({ quizLength: selected });
    showToast({ variant: 'success', message: t('settings.prefsSaved') });
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('settings.quizTitle')}>
      <RawText style={styles.quizIntro}>{t('settings.quizInfo')}</RawText>
      {!isPaid && <PremiumGate title={t('settings.quizCustomizeTitle')} body={t('settings.quizCustomizeBody', { count: QUIZ_LENGTH_FREE })} onUpgrade={onUpgrade} />}
      <View style={{ opacity: isPaid ? 1 : 0.45, marginTop: 4 }} pointerEvents={isPaid ? 'auto' : 'none'}>
        {QUIZ_OPTIONS.map((o) => {
          const sel = selected === o.n;
          return (
            // Maestro hook. The row is one iOS accessibility element whose name
            // is the merge of all its text — "20 cards, 1–7 min, · Standard,
            // Recommended" — which is right for a screen reader and a poor thing
            // for a flow to pin: Maestro matches WHOLE text, so no selector for
            // "20 cards" or "Recommended" alone can hit it.
            <Pressable key={o.n} testID={`quiz-length-${o.n}`} onPress={() => setSelected(o.n)} style={[styles.quizOption, { borderColor: sel ? theme.color.brand : theme.color.border, backgroundColor: sel ? theme.color.brandTint : 'transparent' }]} accessibilityRole="radio" accessibilityState={{ selected: sel }}>
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
          <Button title={t('settings.save')} variant="primary" disabled={!dirty} onPress={save} />
        ) : (
          <Button title={t('settings.upgradeToPremium')} variant="primary" onPress={onUpgrade} />
        )}
      </View>
    </Sheet>
  );
}

// ── How Lexicamp works (17 §H3) — the Home educator content, permanently reachable
// here after the Home card is dismissed. Same shared accordion component.
export function HowItWorksSheet({ visible, onClose, onStartTour }: { visible: boolean; onClose: () => void; onStartTour?: () => void }) {
  const { t } = useTranslation();
  return (
    /* scrollable: the accordion's three sections each add a paragraph + a
       graphic, which outgrows the sheet's maxHeight. Without it the overflow is
       simply clipped and unreachable. */
    <Sheet visible={visible} onClose={onClose} title={t('home.edu.title')} scrollable>
      <RawText style={styles.quizIntro}>{t('home.edu.teaser')}</RawText>
      <HowItWorksList onStartTour={onStartTour} />
    </Sheet>
  );
}

// ── SE-07 Support ──────────────────────────────────────────────────────────────
// Rows are PRESSABLE (2026-07-30): they used to be inert text showing an address
// the user had to retype. Email opens a pre-addressed mail composer; Help centre
// opens lexicamp.com/support — the FAQ + contact page that is also the required
// App Store Connect support URL. The old copy pointed at `lexicamp.app/help`,
// which never existed on the live site.
export function SupportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const rows = [
    {
      key: 'email',
      icon: <IconMail size={20} color={theme.color.brand} />,
      label: t('settings.emailSupport'),
      addr: SUPPORT_EMAIL,
      desc: t('settings.emailSupportDesc'),
      // Subject pre-filled so support mail arrives already triaged, and the
      // version rides along without the user having to go find it.
      url: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('settings.emailSupportSubject', { version: appVersionLabel() }))}`,
      a11y: t('settings.emailSupportA11y'),
    },
    {
      key: 'help',
      icon: <IconInfo size={20} color={theme.color.brand} />,
      label: t('settings.helpCenter'),
      addr: SUPPORT_URLS.help.replace(/^https:\/\//, ''),
      desc: t('settings.helpCenterDesc'),
      url: SUPPORT_URLS.help,
      a11y: t('settings.helpCenterA11y'),
    },
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={t('settings.supportTitle')}>
      <View style={styles.supportList}>
        {rows.map((r) => (
          <Pressable
            key={r.key}
            onPress={() => void Linking.openURL(r.url)}
            accessibilityRole="link"
            accessibilityLabel={r.a11y}
            style={({ pressed }) => [styles.supportRow, pressed && styles.supportRowPressed]}
          >
            <View style={styles.supportIcon}>{r.icon}</View>
            <View style={styles.flex1}>
              <RawText style={styles.supportLabel}>{r.label}</RawText>
              <RawText style={styles.supportAddr}>{r.addr}</RawText>
              <RawText style={styles.supportDesc}>{r.desc}</RawText>
            </View>
          </Pressable>
        ))}
        <View style={styles.supportNote}>
          <RawText style={styles.supportNoteText}>{t('settings.billingNote')}</RawText>
        </View>
      </View>
    </Sheet>
  );
}

// ── SE-08 About ────────────────────────────────────────────────────────────────
// Rebuilt 2026-07-30. It previously led with `IconStar` in amber — which is the
// SUMMIT TIER glyph, not the app mark — and hardcoded "Version 1.0.0 (build 1)".
// Now: the real line-art mark (knockout on dark, per the DS convention), the
// two-tone wordmark set in the brand serif, and a version read off the actual
// binary. "Made with ♥" is gone; the tagline already carries the warmth.
export function AboutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const isDark = useIsDark();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('settings.aboutTitle')}>
      <View style={styles.aboutHead}>
        <SvgXml xml={isDark ? BRAND_MARK_KNOCKOUT_XML : BRAND_MARK_XML} width={60} height={60} />
        {/* Two-tone wordmark: "Lexi" in brand ink, "camp" in the accent — the
            design system's wordmark, set in real text rather than SVG <text>,
            so it uses the loaded Spectral face and scales with Dynamic Type. */}
        <RawText style={styles.aboutName} accessibilityLabel="Lexicamp">
          Lexi<RawText style={styles.aboutNameAccent}>camp</RawText>
        </RawText>
        <RawText style={styles.aboutTagline}>{t('settings.aboutTagline')}</RawText>
        <RawText style={styles.aboutVersion}>{t('settings.aboutVersion', { version: appVersionLabel() })}</RawText>
      </View>
      <View style={styles.aboutLinks}>
        {/* Real, live links — constants/legal.ts is the single edit point. */}
        {(
          [
            [t('settings.terms'), LEGAL_URLS.terms],
            [t('settings.privacy'), LEGAL_URLS.privacy],
            [t('settings.acknowledgments'), LEGAL_URLS.acknowledgments],
          ] as const
        ).map(([label, url], i, arr) => (
          <ListItem key={label} title={label} onPress={() => void Linking.openURL(url)} last={i === arr.length - 1} />
        ))}
      </View>
      <RawText style={styles.aboutCopyright}>{t('settings.aboutCopyright')}</RawText>
    </Sheet>
  );
}

// ── Small shared field bits ─────────────────────────────────────────────────
function FieldLabel({ children }: { children: ReactNode }) {
  return <RawText style={styles.fieldLabel}>{children}</RawText>;
}
/** Monitor / sun / moon — the platform-conventional trio, so the row is
 *  readable before the labels are. */
const APPEARANCE_ICON = { system: IconMonitor, light: IconSun, dark: IconMoon } as const;

/** System / Light / Dark. Writes straight to `appearanceStore`; theme/appearance
 *  subscribes and applies it, so there is nothing to save and nothing to undo. */
function AppearancePicker() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const mode = useAppearanceStore((s) => s.mode);
  const setMode = useAppearanceStore((s) => s.setMode);
  return (
    <View style={styles.readOnlyWrap}>
      <View style={styles.appearanceRow} accessibilityRole="radiogroup">
        {APPEARANCE_MODES.map((m) => {
          const sel = mode === m;
          const Icon = APPEARANCE_ICON[m];
          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              testID={`appearance-${m}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: sel }}
              accessibilityLabel={t(`settings.appearance_${m}`)}
              style={[styles.appearanceOption, { borderColor: sel ? theme.color.brand : theme.color.border, backgroundColor: sel ? theme.color.brandTint : 'transparent' }]}
            >
              {/* The icon carries the meaning at a glance; the label disambiguates. */}
              <Icon size={17} color={sel ? theme.color.brand : theme.color.textMuted} />
              <RawText style={[styles.appearanceLabel, { color: sel ? theme.color.brand : theme.color.textStrong }]}>{t(`settings.appearance_${m}`)}</RawText>
            </Pressable>
          );
        })}
      </View>
      <RawText style={styles.readOnlyNote}>{t('settings.appearanceNote')}</RawText>
    </View>
  );
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
  const { color, fonts, radius } = theme;
  return {
    osBlocked: { backgroundColor: 'rgba(217, 119, 6, 0.10)', borderWidth: theme.borderWidth.thin, borderColor: theme.palette.amber[300], borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 14 },
    osBlockedText: { fontFamily: theme.fonts.sans.medium, fontSize: 13, lineHeight: 19, color: theme.color.accentStrong },
    osBlockedLink: { fontFamily: theme.fonts.sans.bold, fontSize: 13, color: theme.color.accentStrong, marginTop: 4 },
    flex1: { flex: 1 },
    fieldLabel: { fontFamily: fonts.sans.semibold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted, marginBottom: 6, marginTop: 4 },

    // 20 §3 v2: username cycler — the recycle button lives inside the field
    // itself (Casey 2026-07-22b: "pressable 'recycle' icon button in the
    // input itself"), hidden (not just disabled) once canCycle is false.
    usernameBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 11, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surfaceSunken },
    usernameValue: { flex: 1, fontFamily: fonts.sans.semibold, fontSize: 16, color: color.textStrong },
    cycleBtn: { padding: 6, borderRadius: radius.pill },
    usernameNote: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textFaint, marginTop: 4, marginBottom: 12 },
    confirmName: { fontFamily: fonts.sans.extra, fontSize: 22, color: color.textStrong, textAlign: 'center', marginTop: 4 },
    confirmBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21, color: color.textMuted, textAlign: 'center', marginTop: 10 },
    confirmCancelWrap: { marginTop: 8 },

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
    gate: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.accentTint, borderWidth: theme.borderWidth.thin, borderColor: color.accentSoft, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 16 },
    gateText: { flex: 1 },
    gateTitle: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.textStrong, marginBottom: 1 },
    gateBody: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted },
    gateBtn: { backgroundColor: color.accentCta, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    gateBtnText: { fontFamily: fonts.sans.bold, fontSize: 12, color: color.textOnAccentCta },

    // notifications
    notifToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: color.surfaceSunken, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 20 },
    notifToggleTitle: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong },
    notifToggleSub: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted },
    timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surfaceSunken, marginBottom: 16 },
    timeText: { fontFamily: fonts.sans.bold, fontSize: 18, color: color.textMuted },
    timeChange: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    dayRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
    dayChip: { flex: 1, aspectRatio: 1, maxHeight: 42, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
    dayChipText: { fontFamily: fonts.sans.bold, fontSize: 13 },
    saveError: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.danger, marginTop: 12 },
    iosPickerWrap: { alignItems: 'center' },

    // quiz length
    quizIntro: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted, marginBottom: 14 },
    appearanceRow: { flexDirection: 'row', gap: 8 },
    appearanceOption: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1.5 },
    appearanceLabel: { fontFamily: fonts.sans.semibold, fontSize: 14 },
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
    supportRowPressed: { opacity: 0.65 },
    supportIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: color.brandSoft, alignItems: 'center', justifyContent: 'center' },
    supportLabel: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong },
    supportAddr: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.brand, marginTop: 2 },
    supportDesc: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 1 },
    supportNote: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: theme.borderWidth.thin, borderColor: color.border, backgroundColor: color.surfaceSunken },
    supportNoteText: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted },

    // about
    // Brand moment: mark, wordmark, tagline, version — tightened so the block
    // reads as one unit instead of four loosely stacked lines.
    aboutHead: { alignItems: 'center', paddingTop: 4, paddingBottom: 22 },
    // The wordmark is set in the brand SERIF (Spectral), matching the design
    // system's logo lockup — the old sans-extra treatment was a different face
    // from the logo it sat under.
    aboutName: { fontFamily: fonts.serif.semibold, fontSize: 30, letterSpacing: -0.6, color: color.textStrong, marginTop: 10 },
    aboutNameAccent: { color: color.accent },
    aboutTagline: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted, textAlign: 'center', marginTop: 8, maxWidth: 260 },
    aboutVersion: { fontFamily: fonts.mono.regular, fontSize: 11, color: color.textFaint, marginTop: 12 },
    aboutLinks: {},
    aboutCopyright: { fontFamily: fonts.sans.regular, fontSize: 11, lineHeight: 17, color: color.textFaint, textAlign: 'center', marginTop: 18 },
  };
});
