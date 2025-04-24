import {jest, expect} from '@jest/globals';

import {isFirefox, getFirefoxVersion, hasDCSignalingLockSupport, isVersionAtLeast, isDevBuild} from './utils';

describe('isFirefox', () => {
    const userAgentGetter = jest.spyOn(window.navigator, 'userAgent', 'get');

    afterAll(() => {
        jest.resetAllMocks();
    });

    it('empty user agent', () => {
        userAgentGetter.mockReturnValue('');
        expect(isFirefox()).toBe(false);
    });

    it('not firefox', () => {
        userAgentGetter.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36');
        expect(isFirefox()).toBe(false);
    });

    it('firefox', () => {
        userAgentGetter.mockReturnValue('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/112.0');
        expect(isFirefox()).toBe(true);
    });
});

describe('getFirefoxVersion', () => {
    const userAgentGetter = jest.spyOn(window.navigator, 'userAgent', 'get');

    afterAll(() => {
        jest.resetAllMocks();
    });

    it('empty user agent', () => {
        userAgentGetter.mockReturnValue('');
        expect(getFirefoxVersion()).toBe(-1);
    });

    it('not firefox', () => {
        userAgentGetter.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36');
        expect(getFirefoxVersion()).toBe(-1);
    });

    it('firefox', () => {
        userAgentGetter.mockReturnValue('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/112.0');
        expect(getFirefoxVersion()).toBe(112);
    });
});

describe('isDevBuild', () => {
    it('should return false when version is missing', () => {
        // eslint-disable-next-line no-undefined
        expect(isDevBuild(undefined)).toBe(false);
    });

    it('should return true for master version', () => {
        expect(isDevBuild('master')).toBe(true);
    });

    it('should return true for versions with dev prefix', () => {
        expect(isDevBuild('1.7.0-dev0')).toBe(false);
        expect(isDevBuild('1.7.0-dev1')).toBe(false);
        expect(isDevBuild('dev-build')).toBe(true);
    });

    it('should return false for regular versions', () => {
        expect(isDevBuild('1.7.0')).toBe(false);
        expect(isDevBuild('1.8.0')).toBe(false);
        expect(isDevBuild('2.0.0')).toBe(false);
        expect(isDevBuild('1.7.0-alpha-dev')).toBe(false);
        expect(isDevBuild('1.7.0-alpha.dev')).toBe(false);
        expect(isDevBuild('something-with-dev-in-it')).toBe(false);
    });
});

describe('isVersionAtLeast', () => {
    it('should return false when version is missing', () => {
        // eslint-disable-next-line no-undefined
        expect(isVersionAtLeast(undefined, '1.0.0')).toBe(false);
    });

    it('should return false when version is below minimum', () => {
        expect(isVersionAtLeast('1.6.9', '1.7.0')).toBe(false);
        expect(isVersionAtLeast('1.6.0', '1.7.0')).toBe(false);
        expect(isVersionAtLeast('0.9.0', '1.0.0')).toBe(false);
    });

    it('should return true when version meets or exceeds minimum', () => {
        expect(isVersionAtLeast('1.7.0', '1.7.0')).toBe(true);
        expect(isVersionAtLeast('1.7.1', '1.7.0')).toBe(true);
        expect(isVersionAtLeast('1.8.0', '1.7.0')).toBe(true);
        expect(isVersionAtLeast('2.0.0', '1.7.0')).toBe(true);
    });

    it('should handle invalid version formats', () => {
        expect(isVersionAtLeast('invalid', '1.0.0')).toBe(false);
    });

    it('should return true for dev builds regardless of version requirement', () => {
        expect(isVersionAtLeast('master', '99.99.99')).toBe(true);
        expect(isVersionAtLeast('1.0.0-dev', '2.0.0')).toBe(false);
        expect(isVersionAtLeast('dev-build', '3.0.0')).toBe(true);
    });

    it('should handle pre-release versions correctly', () => {
        // Pre-release versions are greater than the same version without pre-release
        expect(isVersionAtLeast('1.7.1-alpha', '1.7.0')).toBe(true);

        // Pre-release versions are less than the same version without pre-release
        expect(isVersionAtLeast('1.7.0-alpha', '1.7.0')).toBe(false);

        // Comparing pre-release versions
        expect(isVersionAtLeast('1.7.0-beta', '1.7.0-alpha')).toBe(true);
        expect(isVersionAtLeast('1.7.0-alpha', '1.7.0-beta')).toBe(false);
    });
});

describe('hasDCSignalingLockSupport', () => {
    it('should return false when plugin version is missing', () => {
        expect(hasDCSignalingLockSupport({})).toBe(false);
        expect(hasDCSignalingLockSupport({build: '123'})).toBe(false);
    });

    it('should return false when plugin version is below minimum', () => {
        expect(hasDCSignalingLockSupport({version: '1.6.9'})).toBe(false);
        expect(hasDCSignalingLockSupport({version: '1.6.0'})).toBe(false);
        expect(hasDCSignalingLockSupport({version: '0.9.0'})).toBe(false);
    });

    it('should return true when plugin version meets minimum and rtcd_version is missing', () => {
        expect(hasDCSignalingLockSupport({version: '1.7.0'})).toBe(true);
        expect(hasDCSignalingLockSupport({version: '1.7.1'})).toBe(true);
        expect(hasDCSignalingLockSupport({version: '1.8.0'})).toBe(true);
        expect(hasDCSignalingLockSupport({version: '2.0.0'})).toBe(true);
    });

    it('should return false when plugin version meets minimum but rtcd_version is below minimum', () => {
        expect(hasDCSignalingLockSupport({version: '1.7.0', rtcd_version: '1.0.9'})).toBe(false);
        expect(hasDCSignalingLockSupport({version: '1.8.0', rtcd_version: '1.0.0'})).toBe(false);
        expect(hasDCSignalingLockSupport({version: '2.0.0', rtcd_version: '0.9.0'})).toBe(false);
    });

    it('should return true when both plugin version and rtcd_version meet minimum', () => {
        expect(hasDCSignalingLockSupport({version: '1.7.0', rtcd_version: '1.1.0'})).toBe(true);
        expect(hasDCSignalingLockSupport({version: '1.7.1', rtcd_version: '1.1.1'})).toBe(true);
        expect(hasDCSignalingLockSupport({version: '1.8.0', rtcd_version: '1.2.0'})).toBe(true);
        expect(hasDCSignalingLockSupport({version: '2.0.0', rtcd_version: '2.0.0'})).toBe(true);
    });

    it('should handle invalid version formats', () => {
        expect(hasDCSignalingLockSupport({version: 'invalid'})).toBe(false);
        expect(hasDCSignalingLockSupport({version: '1.7.0', rtcd_version: 'invalid'})).toBe(false);
    });
});
