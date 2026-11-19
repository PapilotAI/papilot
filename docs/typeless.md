# Typeless voice notes (experimental)

The macOS desktop app can read and send the dictation shortcut configured in
Typeless. Enable **Settings → Experiments → Typeless voice notes** on the
Mac displaying Papilot. It starts off and is not available in browser clients,
on Windows, or on Linux. A remote server never sends keys on the editor's behalf.

1. Install and open Typeless. Set its dictation shortcut in Typeless Settings.
2. Allow Papilot under **System Settings → Privacy & Security → Accessibility**,
   then select **Refresh** in the experiment card. Development builds may appear
   as Electron. Typeless needs its own microphone permissions and account setup.
3. Enable the experiment, then create a PDF note. Papilot focuses the note and
   sends the configured shortcut once.
4. Use the note's microphone button to send the shortcut again. Keep the note
   open and wait for Typeless to paste the transcript. Edit or submit it normally.

The microphone button shows a spinner during delivery, briefly shows a checkmark
on success, then returns to the microphone. Only errors add a visible message;
screen readers also receive the delivery result. Sending does not submit the
note, and failures leave existing text intact. The settings card shows the
detected shortcut and explains missing installation, configuration, permissions,
or a stopped app.
After changing settings in Typeless, select **Refresh** to update that card.
Every actual send also rereads the configuration.

## What the experiment can and cannot confirm

**The checkmark means the native keyboard events were posted.** Check Typeless's own
voice bar or sound to tell whether it started, stopped, or is still processing.
Papilot does not read recordings, history, or an authoritative recording state.
If Typeless is already recording when a note opens, the shortcut can stop it.
Stop existing dictation before opening another note.

Closing a note does not send another shortcut: without knowing Typeless's state,
that could start a new recording. There is no automatic cancellation or protection
against a late paste after leaving the note. Stop dictation and wait for insertion
before switching notes, tasks, applications, or closing Papilot. Typeless's
[Dictate guide](https://www.typeless.com/help/quickstart/dictate) explains its voice
bar and shortcut behavior.

This is the shortcut-only implementation of
[#231](https://github.com/PapilotAI/papilot/issues/231). Session ownership, automatic
cancellation, and acknowledged start/stop are not implemented. A local native
test on 2026-11-19 with Typeless 2.11.0 read the configured Fn binding and sent it
twice from a disposable Electron window. CoreAudio reported the Typeless helper's
input stream changing from inactive to active and back to inactive. This verifies
native shortcut start/stop on that Mac; it does not verify voice transcription
inside a PDF note or an application-level recording API. Automated tests use a
mocked bridge and do not record audio.

## Detection and native delivery

The desktop main process checks `Typeless.app` in `/Applications` and
`~/Applications`, validates its bundle identifier, and reads only dictation
bindings from `~/Library/Application Support/Typeless/app-settings.json`.
`featureShortcutBindings.dictationMode` takes precedence over the older
`keyboardShortcut.pushToTalk`. Empty or malformed modern bindings never silently
reactivate an old shortcut, and no default such as Fn is assumed.

The first supported configured binding is used. Fn, left/right modifiers,
letters, digits, function keys, and the named navigation/punctuation keys in
`desktop/typeless-control.ts` are supported; mouse bindings and unknown tokens
are unavailable. Compatibility is experimental because Typeless's settings file
is not a public integration API. Detection was checked with Typeless 2.11.0.

A small CoreGraphics helper sends a complete press/release sequence, including
modifier-only Fn. The main process accepts requests only from its own app page,
serializes delivery without queuing extra toggles, and checks the original
textarea again after the helper starts. The helper checks the foreground process
and held modifiers before posting. During delivery, the note stays focused and
Papilot suppresses keyboard/menu actions so an unconsumed shortcut cannot submit
the draft. These checks reduce focus races; they are not an atomic lock across
applications and do not confirm that Typeless accepted the events. Other apps
or macOS features assigned the same global shortcut can also react; resolve
conflicting shortcuts in their settings.

macOS desktop compilation requires Apple's Command Line Tools (`xcode-select
--install`). The helper targets macOS 13 or newer, like Electron, and is shipped
outside the ASAR archive so it can execute. It never patches or injects code into
Typeless.

```sh
node --import tsx scripts/inspect-typeless.ts  # read-only installation/config probe
node --import tsx --test tests/typeless.test.ts
npm run desktop:compile
npm run build
node scripts/check-typeless.mjs              # mocked UI; no microphone use
```

The probe deliberately reports recording as unknown. Unit tests cover configuration
precedence, unsupported bindings, focus loss, repeated requests and helper failures.
The built-UI test covers opt-in, focus, retained drafts, repeated clicks, delayed
insertion, failure/recovery and keyboard actions while delivery is pending.

## Local verification

The 11 targeted unit tests, built-interface Typeless test, existing note-selection
test, type checks, application and desktop compilation, locale checks, and macOS
desktop smoke test passed. Light/dark and narrow-layout screenshots were inspected.
The native Fn test is separate from these deterministic tests.

An earlier full root suite reported 1,307 passes and three failures in CodeBuddy cleanup,
update-server startup, and Writer model naming. All three failures were also
reproduced on the unchanged base with the same built review assets. The full UI
suite stopped at a manuscript-source check; it is not reported as passing.
After integrating `main` at `065ca3fe`, type checks, the app build, all 11 Typeless
unit tests, the Typeless browser check and app translation checks passed again.

Captured UI evidence: [settings](assets/typeless/settings.png),
[note](assets/typeless/note.png), [sending](assets/typeless/sending.png),
[sent](assets/typeless/sent.png), [dark error](assets/typeless/error-dark.png),
and [narrow settings](assets/typeless/settings-narrow.png).

The `switch`, `spinner` and `accessibility` Modern Web Guidance guides informed the
labeled native checkbox, keyboard-operable button, busy state, focus handling and
status announcements. The existing spinner respects reduced-motion preferences;
the checkmark is distinguishable by shape, with a screen-reader announcement.
The existing checkbox/ARIA styling supports browsers without a native switch
attribute, and the microphone button does not announce an invented recording state.
