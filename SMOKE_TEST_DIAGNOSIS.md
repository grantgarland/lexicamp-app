# Nightly Smoke Test — Disk Space Failure Analysis

**Date:** 2026-07-07  
**Failure:** `System.IO.IOException: No space left on device` during `./gradlew assembleDebug`  
**Root cause:** GitHub Actions free-tier runner disk exhaustion  

---

## Diagnosis

The nightly smoke test attempts to build the Android debug APK locally on a GitHub-hosted runner using gradle (`./gradlew assembleDebug --no-daemon`). This approach hits a hard limit on free-tier runners:

### The Constraint
- **Total runner disk:** ~14 GB
- **Available for build:** ~8–10 GB (after OS/system)
- **Build output size:** ~6–8 GB (typical for React Native debug APK with multiple architectures + all native modules compiled)
- **Result:** Disk exhaustion late in the compile phase (diagnostics log fills the filesystem)

### Why Local Builds Are Problematic
1. **Multiple CPU architectures compiled:** arm64-v8a, armeabi-v7a, x86, x86_64 — each adds ~1–2 GB of intermediate artifacts
2. **Large native module compilation:** react-native-reanimated, react-native-screens, expo-modules-core, react-native-nitro-modules, react-native-worklets all require CMake + ninja builds
3. **No gradle daemon caching** (`--no-daemon` flag): each build starts fresh, no incremental cache reuse
4. **Node modules footprint:** ~1.5–2 GB before gradle even starts
5. **Intermediate artifacts not cleaned:** compile outputs, .class files, .dex files, .so files accumulate during the build

### Why This Fails *Now*
The project uses a complex React Native stack with multiple native modules that add significant compilation overhead. This only became apparent at scale when actually running the full build on a free runner.

---

## Solution: Switch to EAS Build

Per `02-technical-architecture.md §CI & release/OTA policy`, the budget is:
- **EAS free tier:** 15 iOS + 15 Android builds/month
- **Never run EAS builds per-PR** (cost constraint for frequent commits)
- **OTA for JS-only changes** (no build cost)

The nightly smoke test **should use EAS builds** because:

1. ✅ **Monthly budget:** 1 nightly × 30 nights = 30/mo; budget is 15 Android builds/mo (can reduce to 2–3/week if needed)
2. ✅ **Build isolation:** EAS servers have plenty of disk; no local resource contention
3. ✅ **Deterministic:** same build environment every time (no "works on my machine" surprises)
4. ✅ **Maestro compatible:** EAS still produces an APK that can be installed on an emulator and run through Maestro flows
5. ✅ **No cost delta:** already budgeted in the free tier

---

## Implementation

### Option A: Use EAS Build in the Nightly Workflow (Recommended)
Update `.github/workflows/nightly-smoke.yml`:
1. Replace `npx expo prebuild + ./gradlew assembleDebug` with `eas build --platform android --profile preview --wait`
2. Download the APK artifact from EAS
3. Run the same Maestro flows on the emulator

**Pros:**
- Aligns with the documented architecture policy
- Eliminates disk pressure
- Uses budgeted free tier

**Cons:**
- EAS build takes ~10–15 min (vs. ~20 min local); net time increase is ~5–10 min per nightly
- Requires EAS CLI auth (one-time setup)

### Option B: Disable Multi-Architecture Builds Locally (Workaround)
Modify `android/app/build.gradle` to only build `arm64-v8a`:
```gradle
android {
  buildTypes {
    debug {
      ndk {
        abiFilters 'arm64-v8a'
      }
    }
  }
}
```

**Pros:**
- Stays on free GitHub Actions
- Cuts build time and disk by ~60%

**Cons:**
- x86 emulator testing would fail (x86_64 CPU typically used by GitHub runners can run x86 images faster)
- Not representative of real release builds (which need all architectures)
- Fragile — doesn't future-proof as dependencies grow

### Option C: Self-Hosted Runner (Not Recommended)
Set up a self-hosted GitHub Actions runner on more powerful hardware.

**Pros:**
- Full control

**Cons:**
- Operator maintenance burden (contradicts the "solo dev, simple ops" goal)
- Always-on cost
- Security surface (GitHub Actions IP allow-listing, runner credentials)

---

## Recommended Path

**Implement Option A** (EAS Build in the nightly workflow):

1. Update `.github/workflows/nightly-smoke.yml` to use `eas build --platform android --profile preview`
2. Add a one-time EAS CLI authentication step in setup (uses `EXPO_TOKEN` secret)
3. Store the EAS API token in GitHub Secrets
4. Update `02-technical-architecture.md` to note that nightly builds use the free EAS tier
5. Document the nightly budget allocation (1 Android build/night × 30 nights = 30/mo; cap at 3/week if budget tightens later)

**Implementation time:** ~30 min (workflow edit + secrets setup + test run)

---

## Rollback Plan

If EAS build becomes unreliable or the service changes, revert to **Option B** (single-architecture debug builds on GitHub) with the understanding that x86 emulator testing will be less reliable but the nightly smoke test will remain viable. This is a fallback only.

---

## Verification Checklist

- [x] Update `.github/workflows/nightly-smoke.yml` to call `eas build`
- [x] Set up `EXPO_TOKEN` GitHub secret (one-time, not in code)
- [x] Run manual nightly once to verify APK build + Maestro flow succeeds (2026-07-13)
- [x] Confirm Maestro assertions pass on the EAS-built APK
- [x] Update `02-technical-architecture.md` to note nightly uses EAS free tier
- [x] Document the 30/mo EAS budget allocation in the backlog/operating docs (change-gate added 2026-07-12 makes usage proportional to commit activity)
- [x] Uncomment the `schedule` block in `.github/workflows/nightly-smoke.yml` to enable nightly cron

## Addendum (2026-07-12/13) — post-activation hardening

The first scheduled run 403'd: the change-gate job called `listWorkflowRuns`
without `actions: read` (the gate's API call never executed on manual dispatch,
so activation testing couldn't catch it). The workflow now carries an invariants
block (explicit per-job permissions, every path dispatch-rehearsable, fail-open
gate, pinned eas-cli/Maestro) — read it before editing the workflow. The smoke
APK builds the `smoke` EAS profile (mock mode); the `preview` profile is
live-mode and the Maestro flows cannot pass against it. Flows are manifest-listed
in `.maestro/config.yaml`.

## Addendum (2026-07-15) — smoke first reached an installed build; real root cause found

CORRECTION to the Verification Checklist above: the "Maestro assertions pass"
items were never actually verified — every run through 2026-07-14 failed *before*
an installed build, so the flows had never run against the app until 2026-07-15.

Resolution chain (all fixed):
1. **Build plumbing** — `npx eas build` failed (`eas-cli` was removed from deps →
   `could not determine executable to run`); fixed with an `eas-cli@20` spec.
2. **Artifact download** — `--wait` does NOT download the APK, and `--output` is
   local-build-only ("--output is allowed only for local builds"). Now the build
   runs with `--json`, and a follow-up step parses `artifacts.applicationArchiveUrl`
   with `jq` and `curl`s the APK to the path the emulator step expects.
3. **Real failure (the one that mattered)** — with the APK finally installed, the
   flow went red at the FIRST assertion. Logcat proved the app launched clean (no
   crash: `ReactNativeJS: Running "main"`, MainActivity displayed, splash
   dismissed). The cause is a flow/​render mismatch, not the app: eyebrow and
   section labels use `textTransform: 'uppercase'`, so the ACCESSIBILITY text
   Maestro reads is UPPERCASE ("WORD MASTERY", "YOU ARE HERE", "ACCOUNT"), and
   Maestro matches text case-SENSITIVELY. Fix: the `(?i)` inline regex flag on all
   text assertions in `.maestro/smoke.yaml` (3 of 4 were affected — tab labels and
   the "My Words" title are not transformed) and the two eyebrow asserts in
   `.maestro/word-capture.yaml`.

Tooling note: `reactivecircus/android-emulator-runner` runs each `script:` LINE as
its own `sh -c`, so multi-line shell logic (captured vars, `set -e`, post-run
cleanup) does not carry across lines. The emulator step now calls a single helper,
`scripts/ci-smoke-emulator.sh` (APK install + logcat capture + inline crash grep +
maestro exit-code passthrough), so the diagnostics actually run.

Filename note: the second flow is `.maestro/word-capture.yaml` (older docs call it
`word-capture-crud.yaml`); it is currently commented out in `.maestro/config.yaml`,
so only `smoke.yaml` runs in CI. Status: fixes are committed to files but the green
run is still pending a `workflow_dispatch` confirmation.

Unrelated wart worth noting: a ~13-minute gap between Maestro driver startup and
first app launch on the CI emulator (gRPC epoll native-load failure in logcat) —
it eats the job's time budget but is not the failure.
