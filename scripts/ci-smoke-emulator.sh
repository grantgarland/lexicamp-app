#!/usr/bin/env bash
# CI-4 nightly smoke — emulator-side runner.
#
# Invoked as a SINGLE command from reactivecircus/android-emulator-runner's
# `script:` field. That action runs each script LINE as its own `sh -c`, so
# inline `VAR=$!`, `set -e`, and any post-command cleanup do NOT carry across
# lines. Keeping the whole sequence in one file gives us one shell, so
# logcat capture, the inline crash grep, and the maestro exit-code passthrough
# all work.
#
# Runs from the repo root (the action's working directory); paths are relative
# to it, matching the download step that places the APK.
set -euo pipefail

APK="android/app/build/outputs/apk/debug/app-debug.apk"

adb install "$APK"

# Capture logcat across the Maestro run. The flows run against a RELEASE build
# (__DEV__=false); if the app crashes or a launch gate blanks the screen, every
# assertion fails identically, so the crash trace is the real signal — not the
# assertion text. The full log ships in the maestro-results artifact.
adb logcat -c
adb logcat -v time > logcat.txt 2>&1 &
LOGCAT_PID=$!

# Don't abort on a failing flow — we still want to harvest diagnostics and then
# re-raise Maestro's exit code as the step's result.
set +e
maestro test .maestro/ --format junit --output maestro-report.xml
STATUS=$?
set -e

kill "$LOGCAT_PID" 2>/dev/null || true

# Surface the app's own crashes/fatals inline so the run log alone is often
# enough to diagnose a red flow without downloading the artifact.
echo "::group::logcat — lexicamp / crashes / fatals"
grep -iE 'lexicamp|FATAL|AndroidRuntime|ReactNative|beginning of crash' logcat.txt | tail -100 || true
echo "::endgroup::"

exit "$STATUS"
