import { create } from 'zustand';
import type { Id } from '../types';

/** select = edición; interact = uso (clic = acción principal). */
export type CanvasMode = 'select' | 'room' | 'connect' | 'interact' | 'wall';
export type BottomTab = 'validation' | 'impact' | 'automations' | 'scenes' | 'budget' | 'energy' | 'logbook' | ExtraBottomTab;
/** Pestañas de la Fase 3 (ver ui/extraTabs.ts). */
export type ExtraBottomTab = 'home' | 'tests';

/** Pestañas del diálogo de ajustes: proyecto (Fase 2) y simulación (Fase 3). */
export type SettingsTab = 'project' | 'simulation';

/** Pestaña del editor de una automatización. */
export type AutomationView = 'visual' | 'yaml' | 'traces';

export type Selection =
  | { kind: 'device'; id: Id }
  | { kind: 'room'; id: Id }
  | { kind: 'connection'; id: Id };

export type SelectionKind = Selection['kind'];

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  /** Detalle opcional en forma de lista (p. ej. motivos de Autoconectar). */
  details?: string[];
  /** Botón de acción opcional dentro del aviso. */
  action?: NoticeAction;
}

export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface NoticeExtra {
  details?: string[];
  action?: NoticeAction;
}

/** Petición al lienzo para encuadrar unos dispositivos. */
export interface FocusRequest {
  deviceIds: Id[];
  nonce: number;
}

/** Menú contextual de un dispositivo, en coordenadas de pantalla. */
export interface ContextMenuState {
  deviceId: Id;
  x: number;
  y: number;
}

/** Altura del panel inferior en píxeles. */
export const BOTTOM_MIN = 160;
export const BOTTOM_DEFAULT = 288;

export interface UiState {
  activeFloorId: Id | null;
  /**
   * Elementos seleccionados. Varios solo para dispositivos (selección múltiple); una sala o una
   * conexión se seleccionan de una en una. El tipo está en `selectionKind`.
   */
  selection: Id[];
  selectionKind: SelectionKind | null;
  /** Dispositivos resaltados (p. ej. desde el panel de validación). */
  highlightedDeviceIds: Id[];
  canvasMode: CanvasMode;
  bottomTab: BottomTab;
  bottomOpen: boolean;
  /** Altura del panel inferior (px). */
  bottomHeight: number;
  /** Panel inferior a pantalla completa. */
  bottomMaximized: boolean;
  showCoverage: boolean;
  notice: Notice | null;
  focusRequest: FocusRequest | null;
  selectedAutomationId: Id | null;
  /** Dispositivo cuyo popover de control está abierto. */
  popoverDeviceId: Id | null;
  contextMenu: ContextMenuState | null;
  /** Dispositivo origen de «Conectar desde aquí». */
  connectFromId: Id | null;
  /** Entidades pendientes de añadir a una escena (diálogo «Añadir a escena»). */
  addToScene: string[] | null;
  shortcutsOpen: boolean;
  /** Ya se ofreció pasar a modo Uso al pulsar Simular. */
  interactOffered: boolean;
  /** Diálogo «Ajustes del proyecto». */
  settingsOpen: boolean;
  /** Pestaña inicial del diálogo de ajustes (proyecto o simulación, abierta desde ⚙). */
  settingsTab: SettingsTab;
  /** Galería de plantillas abierta (opcionalmente centrada en un dispositivo). */
  templateGallery: { deviceId?: Id } | null;
  /** Pestaña activa del editor de automatizaciones. */
  automationView: AutomationView;
  /** Diálogo «Historial de versiones». */
  versionsOpen: boolean;

  setActiveFloor: (id: Id | null) => void;
  /** Selecciona un único elemento (o nada). */
  select: (selection: Selection | null) => void;
  /** Sustituye la selección de dispositivos (o de otro tipo, si se indica). */
  setSelection: (ids: Id[], kind?: SelectionKind) => void;
  /** Añade o quita un dispositivo de la selección (Ctrl/Cmd+clic). */
  toggleSelected: (id: Id) => void;
  setHighlighted: (ids: Id[]) => void;
  setCanvasMode: (mode: CanvasMode) => void;
  setBottomTab: (tab: BottomTab) => void;
  setBottomOpen: (open: boolean) => void;
  setBottomHeight: (px: number) => void;
  setBottomMaximized: (max: boolean) => void;
  toggleCoverage: () => void;
  notify: (text: string, kind?: Notice['kind'], extra?: NoticeExtra) => void;
  clearNotice: () => void;
  focusDevices: (ids: Id[]) => void;
  selectAutomation: (id: Id | null) => void;
  openPopover: (deviceId: Id | null) => void;
  openContextMenu: (menu: ContextMenuState | null) => void;
  setConnectFrom: (deviceId: Id | null) => void;
  setAddToScene: (entityIds: string[] | null) => void;
  setShortcutsOpen: (open: boolean) => void;
  setInteractOffered: (offered: boolean) => void;
  setSettingsOpen: (open: boolean, tab?: SettingsTab) => void;
  openTemplates: (opts: { deviceId?: Id } | null) => void;
  setAutomationView: (view: AutomationView) => void;
  setVersionsOpen: (open: boolean) => void;
  /** Abre una automatización en el panel inferior (opcionalmente en una pestaña). */
  showAutomation: (id: Id, view?: AutomationView) => void;
  reset: () => void;
}

let noticeCounter = 0;

function sameIds(a: Id[], b: Id[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** El elemento seleccionado si hay exactamente uno; null si no hay ninguno o hay varios. */
export function primarySelection(s: Pick<UiState, 'selection' | 'selectionKind'>): Selection | null {
  const id = s.selection[0];
  if (s.selection.length !== 1 || id === undefined || !s.selectionKind) return null;
  return { kind: s.selectionKind, id } as Selection;
}

/** Dispositivos seleccionados (vacío si la selección es una sala o una conexión). */
export function selectedDeviceIds(s: Pick<UiState, 'selection' | 'selectionKind'>): Id[] {
  return s.selectionKind === 'device' ? s.selection : [];
}
let focusCounter = 0;

/** En el móvil (< 768 px) el panel inferior ocupa toda la pantalla: se empieza plegado. */
function initialBottomOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(min-width: 768px)').matches;
}

const initial = {
  activeFloorId: null,
  selection: [] as Id[],
  selectionKind: null as SelectionKind | null,
  highlightedDeviceIds: [],
  canvasMode: 'select' as CanvasMode,
  bottomTab: 'validation' as BottomTab,
  bottomOpen: true,
  bottomHeight: BOTTOM_DEFAULT,
  bottomMaximized: false,
  showCoverage: false,
  notice: null,
  focusRequest: null,
  selectedAutomationId: null,
  popoverDeviceId: null,
  contextMenu: null,
  connectFromId: null,
  addToScene: null,
  shortcutsOpen: false,
  interactOffered: false,
  settingsOpen: false,
  settingsTab: 'project' as SettingsTab,
  templateGallery: null,
  automationView: 'visual' as AutomationView,
  versionsOpen: false,
};

export const useUiStore = create<UiState>()((set) => ({
  ...initial,
  bottomOpen: initialBottomOpen(),
  setActiveFloor: (id) => set({ activeFloorId: id, selection: [], selectionKind: null, popoverDeviceId: null, contextMenu: null }),
  select: (selection) =>
    set((s) => {
      if (!selection) return s.selection.length === 0 && s.selectionKind === null ? s : { selection: [], selectionKind: null };
      if (s.selectionKind === selection.kind && s.selection.length === 1 && s.selection[0] === selection.id) return s;
      return { selection: [selection.id], selectionKind: selection.kind };
    }),
  setSelection: (ids, kind = 'device') =>
    set((s) => {
      const unique = [...new Set(ids)];
      const nextKind = unique.length === 0 ? null : kind;
      if (s.selectionKind === nextKind && sameIds(s.selection, unique)) return s;
      return { selection: unique, selectionKind: nextKind };
    }),
  toggleSelected: (id) =>
    set((s) => {
      const devices = s.selectionKind === 'device' ? s.selection : [];
      const next = devices.includes(id) ? devices.filter((x) => x !== id) : [...devices, id];
      return { selection: next, selectionKind: next.length === 0 ? null : 'device' };
    }),
  setHighlighted: (ids) =>
    set((s) =>
      s.highlightedDeviceIds.length === ids.length && s.highlightedDeviceIds.every((id, i) => id === ids[i])
        ? s
        : { highlightedDeviceIds: ids },
    ),
  setCanvasMode: (mode) =>
    set((s) => ({ canvasMode: mode, connectFromId: mode === 'connect' ? s.connectFromId : null, contextMenu: null })),
  setBottomTab: (tab) => set({ bottomTab: tab, bottomOpen: true }),
  setBottomOpen: (open) => set((s) => ({ bottomOpen: open, bottomMaximized: open ? s.bottomMaximized : false })),
  setBottomHeight: (px) => set({ bottomHeight: Math.max(BOTTOM_MIN, Math.round(px)) }),
  setBottomMaximized: (max) => set((s) => ({ bottomMaximized: max, bottomOpen: max ? true : s.bottomOpen })),
  toggleCoverage: () => set((s) => ({ showCoverage: !s.showCoverage })),
  notify: (text, kind = 'info', extra = {}) =>
    set({
      notice: {
        id: ++noticeCounter,
        text,
        kind,
        ...(extra.details && extra.details.length > 0 ? { details: extra.details } : {}),
        ...(extra.action ? { action: extra.action } : {}),
      },
    }),
  clearNotice: () => set({ notice: null }),
  focusDevices: (ids) => set({ focusRequest: { deviceIds: ids, nonce: ++focusCounter }, highlightedDeviceIds: ids }),
  selectAutomation: (id) => set({ selectedAutomationId: id }),
  openPopover: (deviceId) => set({ popoverDeviceId: deviceId, contextMenu: null }),
  openContextMenu: (menu) => set({ contextMenu: menu }),
  setConnectFrom: (deviceId) => set({ connectFromId: deviceId }),
  setAddToScene: (entityIds) => set({ addToScene: entityIds }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setInteractOffered: (offered) => set({ interactOffered: offered }),
  setSettingsOpen: (open, tab = 'project') => set(open ? { settingsOpen: true, settingsTab: tab } : { settingsOpen: false }),
  openTemplates: (opts) => set({ templateGallery: opts, contextMenu: null }),
  setAutomationView: (view) => set({ automationView: view }),
  setVersionsOpen: (open) => set({ versionsOpen: open }),
  showAutomation: (id, view) =>
    set((s) => ({ selectedAutomationId: id, bottomTab: 'automations', bottomOpen: true, automationView: view ?? s.automationView })),
  reset: () => set({ ...initial, bottomOpen: initialBottomOpen() }),
}));
