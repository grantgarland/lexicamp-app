# Lexicamp transactional email templates

Supabase Auth's default emails are unbranded and say "Supabase Auth" in the
sender line. These replace the bodies; the sender identity is a separate setting
(see step 2).

## Files

| File | Supabase template |
|---|---|
| `reset-password.html` | Reset Password **(the one that matters — see below)** |
| `confirm-signup.html` | Confirm signup |
| `change-email.html` | Change Email Address |
| `magic-link.html` | Magic Link |
| `reauthentication.html` | Reauthentication |
| `_base.html` | not a template — documents the shared markup decisions |

`confirm-signup.html` is included for completeness only: email confirmation is
**OFF** (00 infra decision, 2026-07-05), so Supabase never sends it today. If
confirmation is ever switched on, the template is already branded.

## How to apply (dashboard only — not scriptable via the MCP)

1. **Bodies.** Dashboard → Authentication → Emails → Templates. Pick each
   template, paste the file's full contents into the message body, and set the
   subject (suggestions below). Save each one separately.
2. **Sender identity.** Authentication → Emails → SMTP Settings. The "Supabase
   Auth" name in the From line comes from here, not from the body. Set sender
   name to `Lexicamp` and the sender address to one on a domain you have
   verified with your SMTP provider. ⚠️ Without custom SMTP configured, Supabase's
   built-in mailer only delivers to team-member addresses and rate-limits to a
   handful per hour, so outside testers get nothing.

### Suggested subjects

- Reset Password → `Reset your Lexicamp password`
- Confirm signup → `Confirm your Lexicamp email`
- Change Email → `Confirm your new Lexicamp email`
- Magic Link → `Your Lexicamp sign-in link`
- Reauthentication → `Confirm it is you`

## ⚠️ Do not change `{{ .ConfirmationURL }}` to `{{ .TokenHash }}`

The app's client runs **PKCE** (`flowType: 'pkce'` is pinned in
`src/data/supabase/client.ts`). `{{ .ConfirmationURL }}` produces the
`?code=<uuid>` link that `src/auth/recovery.ts` parses and
`useRecoveryLink` exchanges via `exchangeCodeForSession`. Swapping in a
token-hash style link changes the shape and silently breaks password reset —
that exact mismatch is what made reset a no-op before 2026-08-02.

Each template prints the raw URL under the button too, because some corporate
clients strip `<a href>` and a reset email with a dead button and no fallback
leaves the user stuck.

## Markup constraints (why it looks like 2005 HTML)

- Table layout + fully inline styles: Gmail drops `<style>` blocks in many
  contexts and Outlook renders via Word.
- **No external images.** Remote images are blocked by default in most clients
  and render as a broken box; SVG is stripped nearly everywhere. The wordmark is
  live text in a serif stack. Spectral is not web-safe and will not load, so
  Georgia is the honest fallback and sits close to the real mark.
- Two-tone wordmark preserved: `Lexi` `#1f3d52` + `camp` `#e87722`.
- `color-scheme` meta plus an explicit background on every cell, so Apple Mail's
  auto-invert can't produce dark text on a dark panel.
- A hidden preheader controls the grey preview line next to the subject.

## Testing

Send yourself a real reset from the app (Forgot password), then open it on the
**same device** — PKCE stores the code verifier locally when the reset is
requested, so a link opened on desktop can never complete. Check it in Apple
Mail light and dark, and in Gmail on both web and iOS, since those three cover
most of the rendering quirks above.
