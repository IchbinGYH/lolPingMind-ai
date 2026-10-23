import type { Strings } from './i18n';
import type { PingId } from './pings';

export const ASSISTANT_ACTIONS = [
  { id: 'risk', ping: 'danger' }, { id: 'next', ping: 'push' }, { id: 'todo', ping: 'omw' },
  { id: 'deep', ping: 'allin' }, { id: 'help', ping: 'assist' }, { id: 'extract', ping: 'needvision' },
  { id: 'explain', ping: 'missing' }, { id: 'sources', ping: 'enemyvision' },
  { id: 'critique', ping: 'bait' }, { id: 'clear', ping: 'visioncleared' }, { id: 'translate', ping: 'missingflip' },
] as const satisfies readonly { id: string; ping: PingId }[];

export type AssistantAction = typeof ASSISTANT_ACTIONS[number]['id'];
export type AssistantMode = 'all' | 'questions' | 'off';
export const EXTRACTION_FORMATS = ['text', 'markdown', 'csv', 'latex'] as const;
export type ExtractionFormat = typeof EXTRACTION_FORMATS[number];
export type TranslationTarget = 'auto' | 'zh-CN' | 'en';
export interface AssistantOptions { format: ExtractionFormat; target: TranslationTarget }
export const DEFAULT_ASSISTANT_OPTIONS: AssistantOptions = { format: 'markdown', target: 'auto' };
export interface AssistantSource { id: string; title: string; url: string; excerpt: string; kind: 'paper' | 'encyclopedia' }
export interface AssistantTodo { id: string; createdAt: number; title: string; completed: boolean }

export function isAssistantAction(value: unknown): value is AssistantAction {
  return typeof value === 'string' && ASSISTANT_ACTIONS.some((action) => action.id === value);
}

export function actionForPing(ping: PingId, mode: AssistantMode): AssistantAction | null {
  if (mode === 'off' || (mode === 'questions' && ping !== 'missing')) return null;
  return ASSISTANT_ACTIONS.find((action) => action.ping === ping)?.id ?? null;
}

export function assistantOptions(raw: unknown): AssistantOptions {
  const value = raw && typeof raw === 'object' ? raw as { format?: unknown; target?: unknown } : {};
  return {
    format: EXTRACTION_FORMATS.find((format) => format === value.format) ?? 'markdown',
    target: value.target === 'zh-CN' || value.target === 'en' ? value.target : 'auto',
  };
}

export function actionPrompt(action: AssistantAction, t: Strings, options: AssistantOptions): string {
  if (action === 'extract') return t.assistantPrompts.extract(options.format);
  if (action === 'translate') return t.assistantPrompts.translate(options.target);
  return t.assistantPrompts[action];
}
