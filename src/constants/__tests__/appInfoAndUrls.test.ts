// Guards for the two things that quietly rot: hardcoded version strings, and
// off-app URLs that drift after a domain change.
//
// Context (2026-07-30): the About sheet shipped "Version 1.0.0 (build 1)" as a
// literal, and Support linked to `lexicamp.app/help` — a path that has never
// existed on the live site. Both are the kind of thing nobody notices until a
// reviewer or a user does.
import appConfig from '../../../app.json';

import { appBuild, appVersion, appVersionLabel } from '../appInfo';
import { LEGAL_URLS, SITE_URL, SUPPORT_EMAIL, SUPPORT_URLS } from '../legal';

describe('external URL registry', () => {
  const all = { ...LEGAL_URLS, ...SUPPORT_URLS };

  it('points every destination at the live domain over https', () => {
    for (const [name, url] of Object.entries(all)) {
      expect(`${name}:${url}`).toBe(`${name}:${url}`); // keeps the name in failures
      expect(url.startsWith('https://lexicamp.com/')).toBe(true);
    }
  });

  it('never resurrects the dead lexicamp.app/help path', () => {
    for (const url of Object.values(all)) {
      expect(url).not.toContain('lexicamp.app');
      expect(url).not.toMatch(/\/help$/);
    }
  });

  it('keeps /support at exactly that path — App Store Connect requires it', () => {
    // The site also hard-asserts this path in support.astro. Moving it breaks
    // a store field, not just a link.
    expect(SUPPORT_URLS.help).toBe(`${SITE_URL}/support`);
  });

  it('has no duplicate destinations hiding a copy-paste error', () => {
    const urls = Object.values(all);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('keeps the support mailbox on lexicamp.app (Casey, 2026-07-30)', () => {
    // Deliberately a different domain from the site — matches what
    // lexicamp-site's site.config.ts publishes. Asserted so a well-meaning
    // "fix" to lexicamp.com has to be a conscious decision.
    expect(SUPPORT_EMAIL).toBe('support@lexicamp.app');
  });
});

describe('app version', () => {
  it('always resolves a real version, even with no native module', () => {
    // Under jest `Constants.expoConfig` is null — the same shape as web/dev
    // contexts. The app.json fallback is what stops the sheet rendering an
    // em-dash in exactly the environments used to check it.
    expect(appVersion()).toBe(appConfig.expo.version);
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('omits the build entirely when it cannot be determined', () => {
    // app.json carries no buildNumber/versionCode (builds are versioned
    // remotely), so inventing "(build 1)" would be a lie. The label degrades to
    // the bare version instead.
    if (appBuild() == null) {
      expect(appVersionLabel()).toBe(appVersion());
      expect(appVersionLabel()).not.toContain('(');
    } else {
      expect(appVersionLabel()).toBe(`${appVersion()} (${appBuild()})`);
    }
  });

  it('never renders the old hardcoded string', () => {
    expect(appVersionLabel()).not.toBe('1.0.0 (build 1)');
  });
});
