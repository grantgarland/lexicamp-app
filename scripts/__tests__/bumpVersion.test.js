// The marketing-version bump behind release-ios.yml's `bump` input. A wrong
// answer here costs a build slot and an App Store rejection (build 17,
// 2026-10-14: ITMS-90062, version not higher than the approved 1.0.0).
const { describe, expect, it } = require('@jest/globals');
const { nextVersion, rewriteAppJson } = require('../bump-version');

describe('nextVersion', () => {
  it.each([
    ['1.0.0', 'patch', '1.0.1'],
    ['1.0.9', 'patch', '1.0.10'],
    ['1.4.2', 'minor', '1.5.0'],
    ['1.4.2', 'major', '2.0.0'],
    ['1.4.2', 'none', '1.4.2'],
  ])('%s + %s = %s', (current, bump, expected) => {
    expect(nextVersion(current, bump)).toBe(expected);
  });

  it('rejects an unknown bump instead of shipping the same version', () => {
    expect(() => nextVersion('1.0.0', 'Patch')).toThrow(/bump must be one of/);
    expect(() => nextVersion('1.0.0', undefined)).toThrow(/bump must be one of/);
  });

  it('rejects versions App Store Connect would not accept', () => {
    expect(() => nextVersion('1.0', 'patch')).toThrow(/not plain X.Y.Z/);
    expect(() => nextVersion('1.0.0-beta.1', 'patch')).toThrow(/not plain X.Y.Z/);
  });
});

describe('rewriteAppJson', () => {
  const appJson = JSON.stringify({ expo: { name: 'Lexicamp', version: '1.0.0', ios: { infoPlist: {} } } }, null, 2);

  it('changes exactly the expo.version line', () => {
    const out = rewriteAppJson(appJson, '1.0.0', '1.0.1');
    expect(JSON.parse(out).expo.version).toBe('1.0.1');
    const changed = out.split('\n').filter((line, i) => line !== appJson.split('\n')[i]);
    expect(changed).toEqual(['    "version": "1.0.1",']);
  });

  it('refuses when app.json does not hold the expected version', () => {
    expect(() => rewriteAppJson(appJson, '2.0.0', '2.0.1')).toThrow(/could not locate/);
  });
});
