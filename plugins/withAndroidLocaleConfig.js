// withAndroidLocaleConfig — Expo config plugin for Android 13+ per-app language
// (18 §A8b, decision D3: the UI locale follows the OS; users pick the app's
// language in system settings, not inside the app).
//
// What it does at prebuild time:
//   1. writes  android/app/src/main/res/xml/locales_config.xml  listing the
//      locales the UI is localized into, and
//   2. sets    android:localeConfig="@xml/locales_config"  on <application>.
//
// Keep the `locales` option in app.json in sync with src/i18n/locales/ and the
// iOS `CFBundleLocalizations` list. Validated by any EAS Android build (the
// nightly smoke builds the mock-mode `smoke` profile — a green nightly after
// this lands is the confirmation; see 18 §A8b).
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const XML_NAME = 'locales_config';

function localesXml(locales) {
  const items = locales.map((l) => `  <locale android:name="${l}"/>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<locale-config xmlns:android="http://schemas.android.com/apk/res/android">\n${items}\n</locale-config>\n`;
}

/** Write res/xml/locales_config.xml into the native project. */
function withLocalesXml(config, locales) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const resXmlDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(resXmlDir, { recursive: true });
      fs.writeFileSync(path.join(resXmlDir, `${XML_NAME}.xml`), localesXml(locales));
      return cfg;
    },
  ]);
}

/** Point <application android:localeConfig> at the resource. */
function withManifestLocaleConfig(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:localeConfig'] = `@xml/${XML_NAME}`;
    return cfg;
  });
}

module.exports = function withAndroidLocaleConfig(config, { locales = ['en'] } = {}) {
  return withManifestLocaleConfig(withLocalesXml(config, locales));
};
