import type { CallsVersionInfo } from './types/types';
export declare function isFirefox(): boolean;
export declare function getFirefoxVersion(): number;
/**
 * Checks if a version is a development build
 * @param version The version to check
 * @returns true if the version is a development build, false otherwise
 */
export declare function isDevBuild(version: string | undefined): boolean;
/**
 * Checks if a version meets or exceeds a minimum version requirement
 * @param version The version to check
 * @param minVersion The minimum version required
 * @returns true if version >= minVersion or if it's a dev build, false otherwise
 */
export declare function isVersionAtLeast(version: string | undefined, minVersion: string): boolean;
/**
 * Checks if the version info meets the requirements for DC signaling lock support
 * @param versionInfo The version information to check
 * @returns true if the versions support DC signaling lock, false otherwise
 */
export declare function hasDCSignalingLockSupport(versionInfo: CallsVersionInfo): boolean;
