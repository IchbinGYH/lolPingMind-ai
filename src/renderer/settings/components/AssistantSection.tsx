import { Sparkle24Regular } from '@fluentui/react-icons';
import { Button, Field, Input, Select } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { assistantIssueText } from '../../../shared/assistantText';
import type { AssistantActionResult, AssistantConfig } from '../../../shared/ipc';
import type { Settings } from '../../../shared/settings';
import { ASSISTANT_ACTIONS } from '../../../shared/assistantActions';
import { pingById, textureUrl } from '../../../shared/pings';
import { api } from '../api';
import { useText } from '../text';
import type { Update } from '../useAppState';

export function AssistantSection({ settings, update }: { settings: Settings; update: Update }) {
  const t = useText();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    const off = api.onAssistantConfig((next) => { setConfig(next); setConfigFailed(false); });
    void api.getAssistantConfig().then((next) => { setConfig(next); setConfigFailed(false); }).catch((error: unknown) => {
      console.error('[settings] could not load image question settings', error);
      setConfigFailed(true);
    });
    return off;
  }, []);

  const deepseek = settings.assistantProvider === 'deepseek';
  const connected = deepseek ? config?.deepseekKeySet : config?.codexOpen && config.codexCliAvailable && config.codexSignedIn;
  const status = deepseek ? config?.deepseekKeySet ? t.assistantDeepSeekReady : t.assistantIssueKeyMissing
    : !config ? configFailed ? t.assistantConfigUnavailable : t.assistantCodexChecking
    : !config.codexOpen ? t.assistantCodexClosed
      : !config.codexCliAvailable ? t.assistantCliMissing
        : !config.codexSignedIn ? t.assistantSignInRequired : t.assistantCodexRunning;

  const perform = async (action: () => Promise<AssistantActionResult>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      setNotice({ text: result.ok ? result.latencyMs === undefined ? success : t.assistantTestPassed(result.latencyMs)
        : assistantIssueText(result.issue, t), error: !result.ok });
      if (result.ok) setKey('');
      setConfig(await api.getAssistantConfig());
    } catch {
      setNotice({ text: t.assistantConfigUnavailable, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card aiCard">
      <span className="icon"><Sparkle24Regular /></span>
      <div className="aiBody">
        <div className="aiTitle">{t.assistantTitle}</div>
        <div className="desc">{t.assistantDescription}</div>
        <div className="aiNotice">{t.assistantRegionGuide}</div>
        <div className="aiActions aiOpenAssistant"><Button onClick={() => { void api.openAssistantWindow(); }}>
          {t.assistantOpenWindow}</Button></div>
        <Field label={t.assistantModeLabel} className="aiProvider">
          <Select value={settings.assistantMode} onChange={(_, data) => {
            void update({ assistantMode: data.value === 'off' || data.value === 'questions' ? data.value : 'all' });
          }}>
            <option value="all">{t.assistantModeAll}</option>
            <option value="questions">{t.assistantModeQuestions}</option>
            <option value="off">{t.assistantModeOff}</option>
          </Select>
        </Field>
        <Field label={t.assistantProviderLabel} className="aiProvider">
          <Select value={settings.assistantProvider} disabled={busy} onChange={(_, data) => {
            setNotice(null);
            setKey('');
            void update({ assistantProvider: data.value === 'deepseek' ? 'deepseek' : 'codex' });
          }}>
            <option value="codex">{t.assistantProviderCodex}</option>
            <option value="deepseek">{t.assistantProviderDeepSeek}</option>
          </Select>
        </Field>
        {deepseek ? <div className="aiDeepSeek">
          <div className="desc">{t.assistantDeepSeekDescription}</div>
          <Field label={t.assistantKeyLabel}>
            <Input type="password" value={key} autoComplete="off" spellCheck={false} disabled={busy}
              placeholder={config?.deepseekKeySet ? t.assistantKeyStored : t.assistantKeyPlaceholder}
              onChange={(_, data) => setKey(data.value)} />
          </Field>
          <div className="aiActions">
            <Button appearance="primary" disabled={busy || !key.trim()}
              onClick={() => void perform(() => api.saveDeepSeekKey(key), t.assistantKeySaved)}>{t.assistantSaveKey}</Button>
            <Button disabled={busy || !config?.deepseekKeySet || !!key.trim()}
              onClick={() => void perform(() => api.testDeepSeek(), '')}>{t.assistantTest}</Button>
            <Button disabled={busy || !config?.deepseekKeySet}
              onClick={() => void perform(() => api.deleteDeepSeekKey(), t.assistantKeyDeleted)}>{t.assistantDeleteKey}</Button>
          </div>
          {busy ? <div className="aiNotice" role="status">{t.assistantWorking}</div> : null}
          {notice ? <div className={`aiNotice${notice.error ? ' warnText' : ''}`} role="status">{notice.text}</div> : null}
        </div> : null}
        <div className={`aiCodexStatus${connected ? ' running' : ''}`} aria-live="polite">
          <span />{status}
        </div>
        <div className="aiNotice">{deepseek ? t.assistantDeepSeekPrivacy : t.assistantPrivacyDescription}</div>
        <div className="aiActionLegend">
          {ASSISTANT_ACTIONS.map((action) => <div key={action.id}>
            <img src={textureUrl(pingById(action.ping)?.icon ?? 'generic_ping')} alt="" />
            <span><b>{t.assistantActionNames[action.id]}</b><small>{t.assistantActionHints[action.id]}</small></span>
          </div>)}
        </div>
        <div className="aiNotice">{t.assistantActionGuide}</div>
        <div className="aiNotice">{t.questionTodoLocal} {t.questionSourceNotice}</div>
      </div>
    </div>
  );
}
