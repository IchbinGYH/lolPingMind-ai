import { describe, expect, it } from 'vitest';
import { platformOf } from '../../src/shared/platform';
import { strings } from '../../src/shared/i18n';
import { keyboardTriggers, normalizeSettings, triggerLabel } from '../../src/shared/settings';
import { hotkeyLabel, MOD } from '../../src/shared/keys';

describe('Linux platform', () => {
  it('selects Linux independently from Windows and macOS', () => {
    expect(platformOf('linux')).toBe('linux');
    expect(platformOf('darwin')).toBe('mac');
    expect(platformOf('win32')).toBe('win');
  });
  it('uses Linux key names and drops unsupported Caps Lock triggers', () => {
    expect(triggerLabel('win', 'en', 'linux')).toBe('Super');
    expect(hotkeyLabel({mods:MOD.win,vk:0x50}, 'linux')).toBe('Super + P');
    expect(keyboardTriggers('linux')).not.toContain('capslock');
    expect(normalizeSettings({trigger:{vk:0x14}}, 'linux').trigger).toBe('alt');
    expect(normalizeSettings({trigger:'capslock'}, 'linux').trigger).toBe('alt');
  });
  it('explains X11 requirements in both languages instead of asking for macOS permissions', () => {
    for (const lang of ['en','zh-CN'] as const) {
      const t = strings(lang, 'linux');
      expect(t.statusNoAccessHint).toContain('X11');
      expect(t.statusNoAccessHint).toContain('Wayland');
      expect(t.languageAuto).not.toContain('Windows');
      expect(t.limitations.join(' ')).toContain('X11');
    }
  });
});
