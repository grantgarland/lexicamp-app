// maybePromptForReminders — the post-first-save reminders opt-in (3.5, spec `24`).
//
// The behaviours here are worth pinning because getting them wrong is expensive
// and invisible: ⚠️ iOS grants exactly ONE push-permission prompt per install, so
// a second ask can never succeed, and a prompt loop is unfixable from inside the
// app once the user has declined.
import { Alert } from 'react-native';

import { usePrefsStore } from '@/store/prefsStore';

import { maybePromptForReminders } from '../firstSavePrompt';
import { registerForPush, requestPushPermission } from '../push';

// The real module pulls in expo-notifications/expo-device — untransformed ESM
// under jest, and irrelevant to the latch logic under test.
jest.mock('../push', () => ({
  requestPushPermission: jest.fn().mockResolvedValue(true),
  registerForPush: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (k: string) => k } }));

const mockAlert = jest.spyOn(Alert, 'alert');

/** Drive the Alert by pressing one of its buttons. `index` 0 = decline, 1 = accept. */
function answerAlert(index: 0 | 1) {
  mockAlert.mockImplementation(((_t: string, _m: string, buttons: { onPress?: () => void }[]) => {
    buttons[index]?.onPress?.();
  }) as unknown as typeof Alert.alert);
}

/** Dismiss the Alert without choosing (tap-outside / back). */
function dismissAlert() {
  mockAlert.mockImplementation(((
    _t: string,
    _m: string,
    _b: unknown,
    opts: { onDismiss?: () => void },
  ) => {
    opts?.onDismiss?.();
  }) as unknown as typeof Alert.alert);
}

beforeEach(() => {
  jest.clearAllMocks();
  usePrefsStore.setState({ notifPromptSeen: false });
});

describe('maybePromptForReminders', () => {
  it('asks on the first save and registers when accepted', async () => {
    answerAlert(1);
    await maybePromptForReminders();
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(requestPushPermission).toHaveBeenCalledTimes(1);
    expect(registerForPush).toHaveBeenCalledTimes(1);
  });

  it('never asks twice — the second save is silent', async () => {
    answerAlert(1);
    await maybePromptForReminders();
    await maybePromptForReminders();
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it('latches on SHOW, not on accept: declining still prevents a re-ask', async () => {
    // The costly bug this guards: re-prompting a decliner cannot work (iOS has
    // already spent its one system prompt) and reads as nagging. Settings is the
    // documented second chance.
    answerAlert(0);
    await maybePromptForReminders();
    await maybePromptForReminders();
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(requestPushPermission).not.toHaveBeenCalled();
  });

  it('treats dismissal as a decline and does not raise the OS prompt', async () => {
    dismissAlert();
    await maybePromptForReminders();
    expect(requestPushPermission).not.toHaveBeenCalled();
    expect(usePrefsStore.getState().notifPromptSeen).toBe(true);
  });

  it('does not register when the OS permission is denied', async () => {
    answerAlert(1);
    (requestPushPermission as jest.Mock).mockResolvedValueOnce(false);
    await maybePromptForReminders();
    expect(registerForPush).not.toHaveBeenCalled();
  });

  it('never throws into the save path when the permission call rejects', async () => {
    // The caller fires this from saveCard's onSuccess. A save that already
    // succeeded server-side must not surface an error because a prompt failed.
    answerAlert(1);
    (requestPushPermission as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(maybePromptForReminders()).resolves.toBeUndefined();
    expect(registerForPush).not.toHaveBeenCalled();
  });
});
