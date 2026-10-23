import type { CaptureApi, CaptureState } from '../../shared/ipc';
import { strings } from '../../shared/i18n';
import { MIN_CAPTURE_SIZE, moveSelection, resizeSelection, selectionRect,
  type CaptureHandle, type CapturePoint, type CaptureRect } from '../../shared/captureSelection';
import './capture.css';

declare global { interface Window { captureApi: CaptureApi } }

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

async function start(): Promise<void> {
  const state = await window.captureApi.getState();
  if (!state) { window.captureApi.cancel(); return; }
  mount(state);
}

function mount(state: CaptureState): void {
  const t = strings(state.language);
  document.documentElement.lang = state.language;
  document.title = t.captureTitle;
  const stage = element('main', 'captureStage');
  const image = element('img', 'captureImage');
  image.src = state.image;
  image.alt = '';
  image.draggable = false;
  const shade = element('div', 'captureShade');
  const selection = element('div', 'captureSelection');
  selection.setAttribute('role', 'img');
  selection.setAttribute('aria-label', t.captureSelection);
  const size = element('div', 'captureSize');
  selection.append(size);
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
    const node = element('span', 'captureHandle');
    node.dataset.handle = handle;
    selection.append(node);
  }
  const heading = element('header', 'captureHeading');
  const title = element('strong', 'captureTitle');
  title.textContent = t.captureTitle;
  const hint = element('p', 'captureHint');
  hint.textContent = t.captureHint;
  heading.append(title, hint);
  const toolbar = element('div', 'captureToolbar');
  const keys = element('span', 'captureKeys');
  keys.textContent = t.captureKeys;
  const reset = element('button', 'captureButton');
  reset.textContent = t.captureReset;
  const cancel = element('button', 'captureButton');
  cancel.textContent = t.captureCancel;
  const confirm = element('button', 'captureButton primary');
  confirm.textContent = t.captureConfirm;
  toolbar.append(keys, reset, cancel, confirm);
  stage.append(image, shade, selection, heading, toolbar);
  document.body.append(stage);
  let rect: CaptureRect | null = null;
  let drag: { start: CapturePoint; original: CaptureRect | null; handle: CaptureHandle | 'move' | 'draw' } | null = null;
  let submitting = false;
  const valid = (): boolean => rect !== null && rect.width >= MIN_CAPTURE_SIZE && rect.height >= MIN_CAPTURE_SIZE;
  const render = (): void => {
    selection.hidden = rect === null;
    shade.hidden = rect !== null;
    stage.classList.toggle('drawing', drag !== null);
    confirm.disabled = !valid() || submitting;
    reset.disabled = rect === null || submitting;
    if (!rect) return;
    Object.assign(selection.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    size.textContent = t.captureSize(Math.round(rect.width * state.width / innerWidth),
      Math.round(rect.height * state.height / innerHeight));
    size.classList.toggle('inside', rect.y < 38);
  };
  const submit = async (): Promise<void> => {
    if (!rect || !valid() || submitting) return;
    submitting = true;
    render();
    try {
      await window.captureApi.confirm({ x: rect.x * state.width / innerWidth, y: rect.y * state.height / innerHeight,
        width: rect.width * state.width / innerWidth, height: rect.height * state.height / innerHeight });
    } finally { submitting = false; render(); }
  };
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || submitting || (event.target instanceof Node && toolbar.contains(event.target))) return;
    const point = { x: event.clientX, y: event.clientY };
    const handle = event.target instanceof HTMLElement ? event.target.dataset.handle as CaptureHandle | undefined : undefined;
    drag = { start: point, original: rect ? { ...rect } : null,
      handle: handle ?? (event.target instanceof Node && selection.contains(event.target) && rect ? 'move' : 'draw') };
    if (drag.handle === 'draw') rect = selectionRect(point, point, innerWidth, innerHeight);
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
    render();
  });
  stage.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const point = { x: event.clientX, y: event.clientY };
    rect = drag.handle === 'draw' || !drag.original ? selectionRect(drag.start, point, innerWidth, innerHeight)
      : drag.handle === 'move' ? moveSelection(drag.original, point.x - drag.start.x, point.y - drag.start.y, innerWidth, innerHeight)
        : resizeSelection(drag.original, drag.handle, point, innerWidth, innerHeight);
    render();
  });
  const end = (): void => { drag = null; if (!valid()) rect = null; render(); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('contextmenu', (event) => { event.preventDefault(); window.captureApi.cancel(); });
  reset.addEventListener('click', () => { drag = null; rect = null; render(); });
  cancel.addEventListener('click', () => window.captureApi.cancel());
  confirm.addEventListener('click', () => { void submit().catch(() => window.captureApi.cancel()); });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); window.captureApi.cancel(); }
    else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault(); void submit().catch(() => window.captureApi.cancel());
    }
  });
  render();
}

void start().catch(() => window.captureApi.cancel());
