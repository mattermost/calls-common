import semver from 'semver';

import type {CallsVersionInfo} from './types/types';

export function isFirefox() {
    return window.navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
}

export function getFirefoxVersion() {
    const match = window.navigator.userAgent.toLowerCase().match(/firefox\/([0-9]+)\./);

    if (!match || match.length < 2) {
        return -1;
    }

    return parseInt(match[1], 10);
}

/**
 * Checks if a version is a development build
 * @param version The version to check
 * @returns true if the version is a development build, false otherwise
 */
export function isDevBuild(version: string | undefined): boolean {
    if (!version) {
        return false;
    }

    // Consider "master" as a dev build
    if (version === 'master') {
        return true;
    }

    // Check if version has "dev" as a prefix.
    return version.startsWith('dev');
}

/**
 * Checks if a version meets or exceeds a minimum version requirement
 * @param version The version to check
 * @param minVersion The minimum version required
 * @returns true if version >= minVersion or if it's a dev build, false otherwise
 */
export function isVersionAtLeast(version: string | undefined, minVersion: string): boolean {
    if (!version) {
        return false;
    }

    // Dev builds are considered to have the latest features
    if (isDevBuild(version)) {
        return true;
    }

    try {
        return semver.gte(version, minVersion);
    } catch (e) {
        return false;
    }
}

/**
 * Checks if the version info meets the requirements for DC signaling lock support
 * @param versionInfo The version information to check
 * @returns true if the versions support DC signaling lock, false otherwise
 */
export function hasDCSignalingLockSupport(versionInfo: CallsVersionInfo): boolean {
    const minPluginVersion = '1.7.0';
    const minRTCDVersion = '1.1.0';

    // Check plugin version
    const versionCompatible = isVersionAtLeast(versionInfo.version, minPluginVersion);
    if (!versionCompatible) {
        return false;
    }

    // If rtcd_version is missing, we just need to check the plugin version
    if (!versionInfo.rtcd_version) {
        return versionCompatible;
    }

    // Check RTCD version if present
    return isVersionAtLeast(versionInfo.rtcd_version, minRTCDVersion);
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
