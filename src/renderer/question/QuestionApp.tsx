import { ArrowUpRight24Regular, Delete16Regular, Settings24Regular, Sparkle24Regular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { AssistantEntry, AssistantState, QuestionApi } from '../../shared/ipc';
import {
  ASSISTANT_ACTIONS, EXTRACTION_FORMATS, isAssistantAction,
  type AssistantAction, type AssistantTodo, type ExtractionFormat, type TranslationTarget,
} from '../../shared/assistantActions';
import { assistantIssueText } from '../../shared/assistantText';
import { strings, type Strings } from '../../shared/i18n';
import { pingById, textureUrl } from '../../shared/pings';
import { AnswerContent } from './AnswerContent';

declare global { interface Window { questionApi: QuestionApi } }

function timeLabel(value: number, language: string): string {
  return new Intl.DateTimeFormat(language, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(new Date(value));
}

function ActionIcon({ action, className = '' }: { action: AssistantAction; className?: string }) {
  const def = pingById(ASSISTANT_ACTIONS.find((item) => item.id === action)?.ping ?? 'missing');
  return <span className={'lensActionIcon ' + className} style={{ '--action-color': def?.color } as CSSProperties}>
    <img src={textureUrl(def?.icon ?? 'generic_ping')} alt="" />
  </span>;
}

export function QuestionApp() {
  const [state, setState] = useState<AssistantState | null>(null);
  const [tab, setTab] = useState<'history' | 'todos'>('history');
  const [filter, setFilter] = useState('all');
  const [managing, setManaging] = useState(false);
  useEffect(() => {
    const off = window.questionApi.onState(setState);
    void window.questionApi.getState().then(setState);
    return off;
  }, []);
  useEffect(() => { setTab(state?.selectedTodoId ? 'todos' : 'history'); }, [state?.selectedId, state?.selectedTodoId]);
  const t = strings(state?.language ?? (/^zh/i.test(navigator.language) ? 'zh-CN' : 'en'), 'win');
  useEffect(() => { document.title = t.appName; }, [t]);
  const selected = useMemo(() => state?.entries.find((entry) => entry.id === state.selectedId) ?? state?.entries[0] ?? null, [state]);
  const selectedTodo = state?.todos.find((todo) => todo.id === state.selectedTodoId) ?? null;
  const openSettings = () => window.questionApi.openSettings();
  const deepseek = state?.provider === 'deepseek';
  const ready = state?.mode !== 'off' && (deepseek ? state?.deepseekKeySet
    : state?.codexOpen && state.codexCliAvailable && state.codexSignedIn);
  const entries = state?.entries.filter((entry) => filter === 'all' || entry.action === filter) ?? [];
  const todoCount = state?.todos.filter((todo) => !todo.completed).length ?? 0;
  const openTodos = () => {
    setTab('todos');
    if (!state?.selectedTodoId && state?.todos[0]) window.questionApi.selectTodo(state.todos[0].id);
  };

  return <div className="lensApp">
    <aside className="lensRail">
      <div className="lensBrand">
        <div className="lensMark"><img src={textureUrl('generic_ping')} alt="" /></div>
        <div><div className="lensBrandName">{t.appName}</div><div className="lensProduct">{t.questionTitle}</div></div>
      </div>
      <div className="lensStatus"><span className={'lensStatusDot' + (ready ? ' ready' : '')} />
        <span>{state?.mode === 'off' ? t.assistantModeOff : ready ? deepseek ? t.assistantDeepSeekReady : t.questionReady
          : deepseek ? t.assistantIssueKeyMissing : !state?.codexOpen ? t.questionNeedsCodex
            : !state.codexCliAvailable ? t.questionNeedsCli : t.questionNeedsSignIn}</span>
      </div>
      <div className="lensTabs">
        <button className={tab === 'history' ? 'active' : ''} onClick={() => {
          setTab('history'); window.questionApi.selectTodo(null);
        }}>{t.questionRecords}<span>{state?.entries.length ?? 0}</span></button>
        <button className={tab === 'todos' ? 'active' : ''} onClick={openTodos}>{t.questionTodos}<span>{todoCount}</span></button>
      </div>
      {tab === 'history' ? <>
        <div className="lensHistoryHeader">
          <select className="lensFilter" aria-label={t.questionHistory} value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">{t.questionHistory}</option>
            {ASSISTANT_ACTIONS.filter((action) => action.id !== 'clear').map((action) =>
              <option key={action.id} value={action.id}>{t.assistantActionNames[action.id]}</option>)}
          </select>
          <button className="lensManageButton" onClick={() => setManaging((value) => !value)}>
            {managing ? t.questionHistoryDone : t.questionHistoryManage}
          </button>
        </div>
        <div className="lensHistory">{entries.map((entry) => <div key={entry.id} className="lensHistoryRow">
          <button className={'lensHistoryItem' + (entry.id === selected?.id ? ' active' : '')}
            onClick={() => window.questionApi.selectEntry(entry.id)}>
            <ActionIcon action={entry.action} />
            <span className="lensHistoryText"><span title={entry.title ?? t.assistantActionNames[entry.action]}>
              {entry.title ?? t.assistantActionNames[entry.action]}</span>
              <small>{t.assistantActionNames[entry.action]} · {timeLabel(entry.createdAt, t.lang)}{entry.status === 'queued' ? ' · ' + t.questionQueued
                : entry.status === 'cancelled' ? ' · ' + t.questionCancelled : ''}</small></span>
            {!managing ? <ArrowUpRight24Regular className="lensHistoryArrow" /> : null}
          </button>
          {managing ? <button className="lensDeleteButton" title={t.questionHistoryDelete} aria-label={t.questionHistoryDelete}
            onClick={() => window.questionApi.deleteEntry(entry.id)}><Delete16Regular /></button> : null}
        </div>)}</div>
      </> : <div className="lensHistory">
        {state?.todos.map((todo) => <div key={todo.id} className={'lensTodoRow' + (todo.completed ? ' completed' : '')}>
          <input type="checkbox" checked={todo.completed} aria-label={todo.completed ? t.questionTodoReopen : t.questionTodoComplete}
            onChange={(event) => { void window.questionApi.completeTodo(todo.id, event.target.checked); }} />
          <button className={'lensHistoryItem' + (todo.id === selectedTodo?.id ? ' active' : '')}
            onClick={() => window.questionApi.selectTodo(todo.id)}>
            <span className="lensHistoryText"><span>{todo.title}</span><small>{timeLabel(todo.createdAt, t.lang)}</small></span>
          </button>
        </div>)}
      </div>}
      <div className="lensRailFooter">
        <p>{tab === 'todos' ? t.questionTodoLocal : deepseek ? t.assistantDeepSeekPrivacy : t.assistantPrivacyDescription}</p>
        <button className="lensSettingsButton" onClick={openSettings}><Settings24Regular />{t.questionOpenSettings}</button>
      </div>
    </aside>

    <main className="lensMain">
      <header className="lensHeader">
        <div><div className="lensEyebrow"><Sparkle24Regular />{tab === 'todos' ? t.questionTodos : t.questionMarkedArea}</div>
          <h1>{t.questionTitle}</h1><p>{t.questionSubtitle}</p></div>
        <div className="lensHeaderTools">
          <button className="lensIconButton" title={t.questionClearWorkspace} aria-label={t.questionClearWorkspace}
            onClick={() => window.questionApi.clearWorkspace()}><Delete16Regular /></button>
          <button className="lensIconButton" title={t.questionOpenSettings} aria-label={t.questionOpenSettings}
            onClick={openSettings}><Settings24Regular /></button>
        </div>
      </header>
      <div className="lensContent">
        {state?.workspaceIssue ? <p className="lensWorkspaceError" role="alert">{assistantIssueText(state.workspaceIssue, t)}</p> : null}
        {tab === 'todos' ? selectedTodo ? <TodoView key={selectedTodo.id} todo={selectedTodo} image={state?.todoImage ?? null} t={t} />
          : <div className="lensTodoEmpty"><ActionIcon action="todo" /><p>{t.questionTodoEmpty}</p></div>
          : selected ? <EntryView key={selected.id} entry={selected} t={t} />
            : <EmptyView t={t} onOpenSettings={openSettings} />}
      </div>
    </main>
  </div>;
}

function EntryView({ entry, t }: { entry: AssistantEntry; t: Strings }) {
  const [action, setAction] = useState<AssistantAction>(entry.action);
  const [format, setFormat] = useState<ExtractionFormat>(entry.options.format);
  const [target, setTarget] = useState<TranslationTarget>(entry.options.target);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  useEffect(() => {
    setAction(entry.action); setFormat(entry.options.format); setTarget(entry.options.target); setCopyStatus('idle');
  }, [entry.action, entry.options.format, entry.options.target, entry.createdAt]);
  const status = entry.status === 'queued' ? entry.phase === 'selecting' ? t.questionSelecting : t.questionQueued
    : entry.status === 'done' ? t.questionDone
    : entry.status === 'cancelled' ? t.questionCancelled : entry.status === 'asking'
      ? entry.phase === 'searching' ? t.questionSearching : entry.action === 'deep' ? t.questionDeepLoading : t.questionLoading
      : t.questionError;
  const copy = async () => {
    try { setCopyStatus(await window.questionApi.copyAnswer(entry.id) ? 'ok' : 'error'); }
    catch { setCopyStatus('error'); }
  };
  return <article className="lensEntry">
    <div className="lensEntryMeta"><ActionIcon action={entry.action} className="small" />
      <b>{t.assistantActionNames[entry.action]}</b><span>{timeLabel(entry.createdAt, t.lang)}</span>
      <span className="lensMetaDivider">/</span><span>{status}</span>
    </div>
    {entry.image ? <figure className="lensImageFrame"><img src={entry.image} alt={t.questionImageAlt} />
      <figcaption><span />{t.questionMarkedArea}</figcaption></figure>
      : entry.status === 'asking' || entry.status === 'queued'
        ? <div className="lensCapturePlaceholder"><span className="lensSpinner" />{status}</div> : null}

    {entry.image ? <section className="lensActionBar">
      <label>{t.questionActions}<select value={action} onChange={(event) => {
        if (isAssistantAction(event.target.value)) setAction(event.target.value);
      }}>{ASSISTANT_ACTIONS.filter((item) => item.id !== 'clear').map((item) =>
        <option key={item.id} value={item.id}>{t.assistantActionNames[item.id]}</option>)}</select></label>
      {action === 'extract' ? <label>{t.questionFormat}<select value={format} onChange={(event) => {
        const next = EXTRACTION_FORMATS.find((item) => item === event.target.value);
        if (next) setFormat(next);
      }}>{EXTRACTION_FORMATS.map((item) => <option key={item} value={item}>{t.questionFormats[item]}</option>)}</select></label> : null}
      {action === 'translate' ? <label>{t.questionTarget}<select value={target} onChange={(event) => {
        setTarget(event.target.value === 'en' || event.target.value === 'zh-CN' ? event.target.value : 'auto');
      }}>{(['auto', 'zh-CN', 'en'] as const).map((item) => <option key={item} value={item}>{t.questionTargets[item]}</option>)}</select></label> : null}
      <button className="lensSettingsButton primary" onClick={() => window.questionApi.rerun(entry.id, action, { format, target })}>
        {t.questionRerun}
      </button>
    </section> : null}
    <section className="lensBubble questionBubble"><div className="lensBubbleLabel">{t.questionPrompt}</div><p>{entry.question}</p></section>
    <section className={'lensAnswer' + (entry.status === 'error' ? ' failed' : '')} aria-live="polite">
      <div className="lensAnswerHeading"><ActionIcon action={entry.action} />
        <div><div className="lensBubbleLabel">{t.questionAnswer}</div><h2>{status}</h2></div>
        {entry.answer ? <button className="lensCopyButton" onClick={() => void copy()}>
          {copyStatus === 'ok' ? t.questionCopied : t.questionCopy}</button> : null}
      </div>
      {entry.answer ? <AnswerContent entry={entry} /> : null}
      {copyStatus === 'error' ? <p>{t.questionCopyFailed}</p> : null}
      {entry.status === 'asking' || entry.status === 'queued' ? <div className="lensThinking"><span /><span /><span /></div>
        : entry.status === 'error' ? <p>{assistantIssueText(entry.issue, t)}</p> : null}
      {entry.todoId ? <button className="lensSettingsButton lensTodoLink" onClick={() => window.questionApi.selectTodo(entry.todoId ?? null)}>
        {t.questionTodos}</button> : null}
    </section>
    {entry.searchQuery ? <p className="lensSourceQuery">{t.questionSearchQuery}：{entry.searchQuery}</p> : null}
    {entry.sources?.length ? <section className="lensSources">
      <h3>{t.questionSources}</h3><p>{t.questionSourceNotice}</p>
      {entry.sources.map((source) => <button key={source.id} onClick={() => window.questionApi.openSource(entry.id, source.id)}>
        <span className="lensSourceNumber">{source.id}</span><span><b>{source.title}</b><small>{new URL(source.url).hostname}</small></span>
        <ArrowUpRight24Regular />
      </button>)}
    </section> : null}
  </article>;
}

function TodoView({ todo, image, t }: { todo: AssistantTodo; image: string | null; t: Strings }) {
  const [title, setTitle] = useState(todo.title);
  const [busy, setBusy] = useState(false);
  useEffect(() => setTitle(todo.title), [todo.title]);
  const save = async () => {
    setBusy(true);
    try { await window.questionApi.renameTodo(todo.id, title); } finally { setBusy(false); }
  };
  return <article className="lensEntry">
    <div className="lensEntryMeta"><ActionIcon action="todo" /><b>{t.questionTodos}</b>
      <span>{timeLabel(todo.createdAt, t.lang)}</span><span className={'lensTaskBadge' + (todo.completed ? ' complete' : '')}>
        {todo.completed ? t.questionTodoCompleted : t.questionTodoOpen}</span>
    </div>
    <section className="lensTodoEditor">
      <label htmlFor="todo-title">{t.questionTodoTitle}</label>
      <input id="todo-title" value={title} maxLength={160} disabled={busy} onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && title.trim()) void save(); }} />
      <div className="lensTodoButtons">
        <button className="lensSettingsButton primary" disabled={busy || !title.trim() || title.trim() === todo.title}
          onClick={() => void save()}>{t.questionTodoRename}</button>
        <button className="lensSettingsButton" onClick={() => { void window.questionApi.completeTodo(todo.id, !todo.completed); }}>
          {todo.completed ? t.questionTodoReopen : t.questionTodoComplete}</button>
        <button className="lensSettingsButton danger" onClick={() => { void window.questionApi.deleteTodo(todo.id); }}>
          {t.questionTodoDelete}</button>
      </div>
    </section>
    {image ? <figure className="lensImageFrame"><img src={image} alt={t.questionImageAlt} /></figure> : null}
    <p className="lensSourceQuery">{t.questionTodoLocal}</p>
    {image ? <div className="lensTodoActions">{(['explain', 'deep', 'help', 'extract', 'translate'] as const).map((action) =>
      <button className="lensSettingsButton" key={action} onClick={() => window.questionApi.analyzeTodo(todo.id, action)}>
        <ActionIcon action={action} className="small" />{t.assistantActionNames[action]}</button>)}</div> : null}
  </article>;
}

function EmptyView({ t, onOpenSettings }: { t: Strings; onOpenSettings(): void }) {
  return <div className="lensActionWelcome">
    <div className="lensWelcomeHeading"><div className="lensEmptyIcon"><img src={textureUrl('generic_ping')} alt="" /></div>
      <div><h2>{t.questionEmptyTitle}</h2><p>{t.questionEmptyBody}</p></div></div>
    <div className="lensActionGrid">{ASSISTANT_ACTIONS.map((action) => <div className="lensActionCard" key={action.id}>
      <ActionIcon action={action.id} /><div><h3>{t.assistantActionNames[action.id]}</h3><p>{t.assistantActionHints[action.id]}</p></div>
    </div>)}</div>
    <p className="lensSourceQuery">{t.assistantActionGuide}</p>
    <button className="lensSettingsButton" onClick={onOpenSettings}><Settings24Regular />{t.questionOpenSettings}</button>
  </div>;
}
