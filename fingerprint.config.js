// Fingerprint config for expo-updates (`runtimeVersion: { policy: "fingerprint" }`).
//
// The runtime version decides which installed binaries an OTA update may reach,
// so it should change when NATIVE code changes and not otherwise. By default
// the fingerprint also hashes `expo.version`, so every marketing-version bump
// (1.0.1 → 1.0.2) minted a new runtime: an OTA built from main would reach only
// the newest store version, and users one release behind would stop getting
// JS fixes despite identical native code. Verified 2026-10-14: the hash moved
// from 008837f… to 91167a7… on a version-only change.
//
// ExpoConfigVersions skips `version`, `ios.buildNumber` and
// `android.versionCode`; none of these affects native compatibility. The
// first skip is the library default, restated because setting `sourceSkips`
// here REPLACES the default rather than adding to it.
//
// ⚠️ Changing this file changes the fingerprint of every future build. It
// landed before the first expo-updates binary shipped, so nothing in the field
// depended on the old value. Edit it again only alongside a store release.
const { SourceSkips } = require('@expo/fingerprint');

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  sourceSkips: SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun | SourceSkips.ExpoConfigVersions,
};
