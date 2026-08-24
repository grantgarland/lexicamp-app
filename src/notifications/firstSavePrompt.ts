// The post-first-save reminders prompt (3.5, spec `24`).
//
// WHY IT LIVES HERE AND NOT IN ONBOARDING: the opt-in used to be step 8 of the
// pre-auth arc, asked before the user owned a single word. That is asking to be
// denied — and ⚠️ iOS grants exactly ONE permission prompt per install, so a
// denial there is permanent for that install. Reminders are the product's
// retention mechanism, so spending that single prompt at the worst possible
// moment was the costliest thing the old flow did.
//
// Now it fires straight after the FIRST successful save, which is the first
// moment the user has something to be reminded ABOUT.
//
// ⚠️ `notifPromptSeen` is set when the prompt is SHOWN, not when it is accepted.
// Re-asking someone who declined cannot work (that one iOS prompt is spent) and
// only annoys; Settings is the real second chance, and it explains itself there.
import { Alert } from 'react-native';

import i18n from '@/i18n';
import { usePrefsStore } from '@/store/prefsStore';

import { registerForPush, requestPushPermission } from './push';

/** Ask about reminders once, after the user's first saved word.
 *
 *  Returns immediately (and silently) if the prompt has already been shown. The
 *  caller should fire-and-forget: nothing here may block or fail a save that has
 *  already succeeded server-side. */
export async function maybePromptForReminders(): Promise<void> {
  const { notifPromptSeen, setNotifPromptSeen } = usePrefsStore.getState();
  if (notifPromptSeen) return;
  // Latch BEFORE showing. If the app dies mid-dialog the user is not re-asked on
  // next launch — the alternative risks a prompt loop on a crashy device, and an
  // un-asked user can still enable reminders from Settings.
  setNotifPromptSeen(true);

  const enable = await new Promise<boolean>((resolve) => {
    Alert.alert(
      i18n.t('notifications.firstSaveTitle'),
      i18n.t('notifications.firstSaveBody'),
      [
        { text: i18n.t('notifications.firstSaveDecline'), style: 'cancel', onPress: () => resolve(false) },
        { text: i18n.t('notifications.firstSaveAccept'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
  if (!enable) return;

  // Raise the OS prompt only after the user has said yes to ours, so the single
  // system prompt is spent on someone who has already opted in in principle.
  const granted = await requestPushPermission().catch(() => false);
  if (granted) await registerForPush().catch(() => {});
}
