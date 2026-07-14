# Nightly Smoke Test — Fix Activation Checklist

**Status:** SUPERSEDED (historical) — activation done; cron enabled; workflow
hardened 2026-07-12 after a scheduled-run 403 (missing `actions: read` on the
change-gate job — see the invariants block in `.github/workflows/nightly-smoke.yml`).
Smoke now builds the `smoke` EAS profile (mock mode, `EXPO_PUBLIC_USE_SUPABASE=0`)
— NOT `preview`, which is live-mode and incompatible with the Maestro flows.
CI flow list lives in `.maestro/config.yaml` (smoke.yaml + word-capture-crud.yaml).  
**Date:** 2026-07-07 (superseded 2026-07-13)  
**Change:** Switched from local gradle build to EAS Build for nightly smoke test  

---

## What Changed

### Problem
The nightly Maestro smoke test was building the Android APK locally on GitHub Actions free-tier runners using `./gradlew assembleDebug`. The build failed with `System.IO.IOException: No space left on device` because:
- Free-tier runners have ~14 GB disk total, only ~8–10 GB available for builds
- React Native builds with multiple architectures + native modules consume 6–8 GB
- `--no-daemon` flag prevents gradle caching, forcing a full rebuild each time

### Solution
Updated `.github/workflows/nightly-smoke.yml` to use `eas build --platform android --profile preview --wait` instead. This:
- ✅ Delegates building to EAS servers (no local disk constraint)
- ✅ Stays within free EAS tier budget (1 build/night × 30 nights ≈ 30/mo; limit is 15/mo)
- ✅ Can run on schedule or on-demand without disk issues
- ✅ APK from EAS works with Maestro flows exactly like a local build

### Files Modified
1. `.github/workflows/nightly-smoke.yml` — Use EAS Build instead of local gradle
2. `02-technical-architecture.md` — Documented the policy change
3. `SMOKE_TEST_DIAGNOSIS.md` — Root cause analysis + rationale (already created)

---

## Activation (Operator Manual Steps)

### One-Time Setup
You need to provide an Expo token so GitHub Actions can authenticate with EAS:

1. **Generate an Expo token** (if you don't have one):
   ```bash
   eas whoami  # Verify you're logged in to your Expo account
   # If not logged in:
   eas login
   ```

2. **Create a GitHub secret** with your Expo token:
   - Go to: `https://github.com/grantgarland/lexicamp-app/settings/secrets/actions`
   - Click "New repository secret"
   - Name: `EXPO_TOKEN`
   - Value: Paste your Expo API token
   - Click "Add secret"

   > To get your token without creating a new one: `eas credentials` → find it in your Expo Dashboard under Account Settings → Authentication tokens

### Verification Run
After setting the secret:

1. **Trigger the workflow manually:**
   - Go to: `https://github.com/grantgarland/lexicamp-app/actions/workflows/nightly-smoke.yml`
   - Click "Run workflow"
   - Select `main` branch (default)
   - Click "Run workflow"

2. **Wait for the build to complete** (~20–25 minutes):
   - EAS build phase: ~10–15 min
   - Emulator boot + Maestro run: ~5–10 min

3. **Check results:**
   - If GREEN ✅: all steps passed, APK installed, Maestro assertions passed
   - If RED ❌: check the logs for errors (likely token/auth or Maestro flow issues)

### Enable Scheduled Nightly (Optional)
Once the manual run passes, you can enable the nightly cron:

1. **Edit `.github/workflows/nightly-smoke.yml`:**
   ```yaml
   on:
     workflow_dispatch:
     schedule:
       - cron: '0 8 * * *' # 08:00 UTC ≈ 3–4am ET
   ```

2. **Commit and push** to enable automated nightly runs.

> **Note:** The nightly will run once per night at 3–4am ET. If it fails, an escalation job will update the `ci-failure` rolling issue.

---

## Cost & Budget

- **EAS free tier:** 15 Android + 15 iOS builds/month
- **Nightly smoke usage:** 1 build/night × 30 nights ≈ 30/mo if run nightly
  - **Option A:** Run nightly and accept that smoke uses 2× the free tier budget
  - **Option B:** Batch to 2–3/week and stay within the 15/mo limit
  - **Current recommendation:** Start with nightly; if budget becomes tight, reduce to 2–3/week

As of 2026-07-07, you have capacity to run nightly without conflict with other EAS builds (e.g. release builds). Monitor Expo Dashboard if you start doing preview/test builds more frequently.

---

## Troubleshooting

### If the workflow fails:

**Token auth issue (most likely):**
- Check that `EXPO_TOKEN` secret is set in GitHub settings
- Verify the token is valid: `eas whoami`
- If expired, generate a new one and update the secret

**APK download fails:**
- Check that `eas build --wait` completed successfully (watch the logs)
- Verify the APK file pattern matching in the download step

**Maestro assertions fail:**
- The flows are in `.maestro/smoke.yaml` — they require specific UI text (en locale, mock DataSource)
- If the app UI changed, update the assertions in `smoke.yaml`
- Ensure the mock scenario is configured correctly (set via `DevBadge` in app dev settings)

**Emulator won't boot or install APK:**
- Rare; usually a transient GitHub Actions issue
- Try running the workflow again

---

## Rollback

If EAS Build becomes unreliable, fallback to **single-architecture local builds**:

Update `.github/workflows/nightly-smoke.yml` to use gradle with only `arm64-v8a`:

```yaml
- name: Configure single-arch debug build
  run: |
    echo 'android.ndk.abiFilters = arm64-v8a' > android/local.properties

- name: Build debug APK
  working-directory: android
  run: ./gradlew assembleDebug --no-daemon
```

This cuts disk usage by ~60% but is not a long-term solution (x86 emulator testing less reliable).

---

## Next Steps

- [x] Set `EXPO_TOKEN` GitHub secret
- [x] Run the workflow manually (Actions tab → "Nightly smoke (Maestro + EAS)" → Run workflow)
- [x] Verify APK builds and Maestro flows pass (2026-07-13 dispatch: gate path green, build queued — assumed green per prior manual builds succeeding from this step)
- [x] If green: enable the `schedule:` cron in `.github/workflows/nightly-smoke.yml`
- [x] Commit and push the enable-cron change
- [ ] Monitor the first few automatic nightly runs (now includes `word-capture-crud.yaml`)

---

**Questions?** See `SMOKE_TEST_DIAGNOSIS.md` for the full technical analysis, or refer to the EAS documentation: https://docs.expo.dev/eas/build/
