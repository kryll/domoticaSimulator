import { create } from 'zustand';
import type { Id } from '../types';

/** select = edición; interact = uso (clic = acción principal). */
export type CanvasMode = 'select' | 'room' | 'connect' | 'interact' | 'wall';
export type BottomTab = 'validation' | 'automations' | 'scenes' | 'logbook' | ExtraBottomTab;
/** Pestañas de la Fase 3 (ver ui/extraTabs.ts). */
export type ExtraBottomTab = 'home' | 'dashboard' | 'tests';

export type Selection =
  | { kind: 'device'; id: Id }
  | { kind: 'room'; id: Id }
  | { kind: 'connection'; id: Id };

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
  selection: Selection | null;
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

  setActiveFloor: (id: Id | null) => void;
  select: (selection: Selection | null) => void;
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
  reset: () => void;
}

let noticeCounter = 0;
let focusCounter = 0;

const initial = {
  activeFloorId: null,
  selection: null,
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
};

export const useUiStore = create<UiState>()((set) => ({
  ...initial,
  setActiveFloor: (id) => set({ activeFloorId: id, selection: null, popoverDeviceId: null, contextMenu: null }),
  select: (selection) => set({ selection }),
  setHighlighted: (ids) => set({ highlightedDeviceIds: ids }),
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
  reset: () => set({ ...initial }),
}));
