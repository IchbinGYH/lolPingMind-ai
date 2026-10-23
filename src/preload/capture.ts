import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureApi } from '../shared/ipc';

// Sandboxed preloads must not import a sibling shared chunk at runtime.
const api: CaptureApi = {
  getState: () => ipcRenderer.invoke('capture:state'),
  confirm: (rect) => ipcRenderer.invoke('capture:confirm', rect),
  cancel: () => { void ipcRenderer.invoke('capture:cancel'); },
};
contextBridge.exposeInMainWorld('captureApi', api);
