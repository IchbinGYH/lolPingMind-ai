import { describe, expect, it } from 'vitest';
import { actionForPing, actionPrompt, ASSISTANT_ACTIONS, assistantOptions, DEFAULT_ASSISTANT_OPTIONS } from '../../src/shared/assistantActions';
import { strings } from '../../src/shared/i18n';
import { ALL_PINGS } from '../../src/shared/pings';

describe('assistant actions', () => {
  it('assigns one distinct intent to every wheel icon except the ordinary generic ping', () => {
    const intents = ALL_PINGS.map((ping) => actionForPing(ping.id, 'all')).filter(Boolean);
    expect(intents).toHaveLength(11);
    expect(new Set(intents).size).toBe(11);
    expect(actionForPing('generic', 'all')).toBeNull();
    expect(actionForPing('visioncleared', 'all')).toBe('clear');
  });

  it('preserves classic signals and the baseline question-only mode', () => {
    for (const ping of ALL_PINGS) {
      expect(actionForPing(ping.id, 'off')).toBeNull();
      expect(actionForPing(ping.id, 'questions')).toBe(ping.id === 'missing' ? 'explain' : null);
    }
  });

  it('keeps the exact question prompt and localizes every action in both languages', () => {
    expect(actionPrompt('explain', strings('zh-CN'), DEFAULT_ASSISTANT_OPTIONS)).toBe('这个截图里的内容是什么意思');
    for (const language of ['en', 'zh-CN'] as const) {
      const text = strings(language);
      for (const { id } of ASSISTANT_ACTIONS) {
        expect(text.assistantActionNames[id].length).toBeGreaterThan(0);
        expect(text.assistantActionHints[id].length).toBeGreaterThan(0);
        expect(actionPrompt(id, text, DEFAULT_ASSISTANT_OPTIONS).length).toBeGreaterThan(0);
      }
    }
  });

  it('validates renderer options and uses the requested extraction and translation formats', () => {
    expect(assistantOptions({ format: 'html', target: '<script>' })).toEqual(DEFAULT_ASSISTANT_OPTIONS);
    expect(assistantOptions(null)).toEqual(DEFAULT_ASSISTANT_OPTIONS);
    expect(actionPrompt('extract', strings('en'), { format: 'csv', target: 'auto' })).toContain('as csv');
    expect(actionPrompt('translate', strings('zh-CN'), { format: 'text', target: 'en' })).toContain('英语');
  });
});
