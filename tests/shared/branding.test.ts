import { describe, expect, it } from 'vitest';
import metadata from '../../package.json';
import { APP_NAME, LEGACY_APP_NAME, canCheckUpdates } from '../../src/shared/branding';
import { strings } from '../../src/shared/i18n';

describe('branding', () => {
  it('uses the AI product name for both languages and distributables while retaining upstream attribution', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      const t = strings(lang);
      expect(t.appName).toBe(APP_NAME);
      expect(t.aboutDesc('0.5.1')).toContain(APP_NAME);
      expect(t.trayTip(true)).toContain(APP_NAME);
      expect(t.trayQuit).toContain(APP_NAME);
      expect(t.upstreamAttribution).toContain('lolPing');
      expect(t.upstreamAttribution).toContain('MIT');
      expect(t.manualUpdatesNotice).toBeTruthy();
    }
    expect(metadata.productName).toBe(APP_NAME);
    expect(metadata.build.productName).toBe(APP_NAME);
    expect(metadata.build.nsis.artifactName).toBe('lolPingMind-ai-Setup-${version}.exe');
    expect(metadata.build.publish).toBeNull();
    expect(LEGACY_APP_NAME).toBe('lolPing');
  });

  it('never enables an upstream update feed for an ordinary installation', () => {
    for (const platform of ['win', 'mac', 'linux'] as const) {
      expect(canCheckUpdates(platform, undefined)).toBe(false);
      expect(canCheckUpdates(platform, '')).toBe(false);
    }
  });

  it('allows the explicit updater test mode only on supported updater platforms', () => {
    const testUrl = 'http://127.0.0.1:8123/';
    expect(canCheckUpdates('win', testUrl)).toBe(true);
    expect(canCheckUpdates('mac', testUrl)).toBe(true);
    expect(canCheckUpdates('linux', testUrl)).toBe(false);
  });
});
