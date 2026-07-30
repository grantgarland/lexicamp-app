// Runtime app identity — version + build number read from the ACTUAL binary
// rather than hardcoded in a screen. (The About sheet shipped
// "Version 1.0.0 (build 1)" as a literal until 2026-07-30.)
//
// Resolution order, most to least truthful:
//   1. `nativeApplicationVersion` / `nativeBuildVersion` — the installed app's
//      Info.plist (CFBundleShortVersionString / CFBundleVersion). This is what
//      the user and App Review actually see.
//   2. `Constants.expoConfig` — the resolved config at runtime.
//   3. `app.json` imported directly — a build-time constant that is ALWAYS
//      present, including under jest and in web/dev contexts where the native
//      module isn't loaded. Without this the label degraded to an em-dash in
//      exactly the environments used to verify it.
//
// Build number stays genuinely optional: app.json carries no `buildNumber` /
// `versionCode` because builds are versioned remotely, and inventing "1" would
// be a lie. Callers render the bare version instead.
import Constants from 'expo-constants';

import appConfig from '../../app.json';

type NativeFields = { nativeAppVersion?: string | null; nativeBuildVersion?: string | null };

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Semantic app version, e.g. "1.0.0". */
export function appVersion(): string {
  const native = (Constants as NativeFields).nativeAppVersion;
  if (nonEmpty(native)) return native;
  if (nonEmpty(Constants.expoConfig?.version)) return Constants.expoConfig!.version!;
  return appConfig.expo.version;
}

/** Platform build number as a string, or null when it genuinely isn't known. */
export function appBuild(): string | null {
  const native = (Constants as NativeFields).nativeBuildVersion;
  if (nonEmpty(native)) return native;
  const ios = Constants.expoConfig?.ios?.buildNumber;
  if (nonEmpty(ios)) return ios;
  const android = Constants.expoConfig?.android?.versionCode;
  if (typeof android === 'number') return String(android);
  return null;
}

/** "1.0.0 (42)" — or just "1.0.0" when no build number is available. */
export function appVersionLabel(): string {
  const build = appBuild();
  const version = appVersion();
  return build == null ? version : `${version} (${build})`;
}
