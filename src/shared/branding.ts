import type { Platform } from './platform';

export const APP_NAME = 'lolPingMind-ai';
export const UPSTREAM_PROJECT_URL = 'https://github.com/darrenprx/lolPing';
/** Retain the profile and credential identity used by existing installations. */
export const LEGACY_APP_NAME = 'lolPing';

/** The fork has no release feed yet; only the explicit local update-test mode may run a checker. */
export function canCheckUpdates(platform: Platform, testUrl: string | undefined): boolean {
  return platform !== 'linux' && !!testUrl;
}

