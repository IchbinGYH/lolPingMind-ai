import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AssistantState, QuestionApi } from '../shared/ipc';

// Keep the names inline: this sandboxed preload cannot require a shared sibling chunk.
const CHANNEL = {
  get: 'assistant:getState',
  state: 'assistant:state',
  openSettings: 'assistant:openSettings',
  select: 'assistant:select',
  deleteEntry: 'assistant:deleteEntry',
  clearHistory: 'assistant:clearHistory',
  rerun: 'assistant:rerun', copy: 'assistant:copyAnswer', source: 'assistant:openSource',
  todoSelect: 'assistant:selectTodo', todoRename: 'assistant:renameTodo', todoComplete: 'assistant:completeTodo',
  todoDelete: 'assistant:deleteTodo', todoAnalyze: 'assistant:analyzeTodo', clearWorkspace: 'assistant:clearWorkspace',
} as const;

function subscribe(cb: (state: AssistantState) => void): () => void {
  const handler = (_event: IpcRendererEvent, state: AssistantState) => cb(state);
  ipcRenderer.on(CHANNEL.state, handler);
  return () => ipcRenderer.removeListener(CHANNEL.state, handler);
}

const api: QuestionApi = {
  getState: () => ipcRenderer.invoke(CHANNEL.get),
  onState: subscribe,
  openSettings: () => { void ipcRenderer.invoke(CHANNEL.openSettings); },
  selectEntry: (id) => { void ipcRenderer.invoke(CHANNEL.select, id); },
  deleteEntry: (id) => { void ipcRenderer.invoke(CHANNEL.deleteEntry, id); },
  clearHistory: () => { void ipcRenderer.invoke(CHANNEL.clearHistory); },
  rerun: (id, action, options) => { void ipcRenderer.invoke(CHANNEL.rerun, id, action, options); },
  copyAnswer: (id) => ipcRenderer.invoke(CHANNEL.copy, id),
  openSource: (id, sourceId) => { void ipcRenderer.invoke(CHANNEL.source, id, sourceId); },
  selectTodo: (id) => { void ipcRenderer.invoke(CHANNEL.todoSelect, id); },
  renameTodo: (id, title) => ipcRenderer.invoke(CHANNEL.todoRename, id, title),
  completeTodo: (id, completed) => ipcRenderer.invoke(CHANNEL.todoComplete, id, completed),
  deleteTodo: (id) => ipcRenderer.invoke(CHANNEL.todoDelete, id),
  analyzeTodo: (id, action) => { void ipcRenderer.invoke(CHANNEL.todoAnalyze, id, action); },
  clearWorkspace: () => { void ipcRenderer.invoke(CHANNEL.clearWorkspace); },
};

contextBridge.exposeInMainWorld('questionApi', api);
