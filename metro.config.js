const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const { isLiveBuild, stubFor } = require("./metro/excludedModules");

const config = getSentryExpoConfig(__dirname);

// Keep dev-only and mock-only modules out of shipped bundles (App Store review,
// and bundle size). See `metro/excludedModules.js` for the module list and for
// why each one is keyed on the axis it is.
//
// Resolve FIRST, then decide: the check is on the resolved absolute path, so it
// catches every spelling of the same import (`@/dev/DevBadge`, a relative path,
// a re-export) instead of pattern-matching request strings.
//
// `context.dev` is Metro's own per-bundle dev flag — the same value the bundle
// sees as `__DEV__`. Using it rather than `process.env.NODE_ENV` means the swap
// tracks the bundle actually being built, with no guessing about which CLI or
// EAS profile invoked it. The live-backend flag has no such per-bundle
// equivalent, so it is read from the environment once, here.
const useSupabase = isLiveBuild();
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  const resolution = resolve(context, moduleName, platform);
  if (resolution.type !== "sourceFile") return resolution;

  const stub = stubFor({
    projectRoot: __dirname,
    filePath: resolution.filePath,
    dev: context.dev,
    useSupabase,
  });
  return stub == null ? resolution : { type: "sourceFile", filePath: stub };
};

module.exports = config;
