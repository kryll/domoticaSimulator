import { create } from 'zustand';
import type { Id } from '../types';

export type CanvasMode = 'select' | 'room' | 'connect';
export type BottomTab = 'validation' | 'automations' | 'scenes' | 'logbook';

export type Selection =
  | { kind: 'device'; id: Id }
  | { kind: 'room'; id: Id }
  | { kind: 'connection'; id: Id };

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

/** Petición al lienzo para encuadrar unos dispositivos. */
export interface FocusRequest {
  deviceIds: Id[];
  nonce: number;
}

export interface UiState {
  activeFloorId: Id | null;
  selection: Selection | null;
  /** Dispositivos resaltados (p. ej. desde el panel de validación). */
  highlightedDeviceIds: Id[];
  canvasMode: CanvasMode;
  bottomTab: BottomTab;
  bottomOpen: boolean;
  showCoverage: boolean;
  notice: Notice | null;
  focusRequest: FocusRequest | null;
  selectedAutomationId: Id | null;

  setActiveFloor: (id: Id | null) => void;
  select: (selection: Selection | null) => void;
  setHighlighted: (ids: Id[]) => void;
  setCanvasMode: (mode: CanvasMode) => void;
  setBottomTab: (tab: BottomTab) => void;
  setBottomOpen: (open: boolean) => void;
  toggleCoverage: () => void;
  notify: (text: string, kind?: Notice['kind']) => void;
  clearNotice: () => void;
  focusDevices: (ids: Id[]) => void;
  selectAutomation: (id: Id | null) => void;
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
  showCoverage: false,
  notice: null,
  focusRequest: null,
  selectedAutomationId: null,
};

export const useUiStore = create<UiState>()((set) => ({
  ...initial,
  setActiveFloor: (id) => set({ activeFloorId: id, selection: null }),
  select: (selection) => set({ selection }),
  setHighlighted: (ids) => set({ highlightedDeviceIds: ids }),
  setCanvasMode: (mode) => set({ canvasMode: mode }),
  setBottomTab: (tab) => set({ bottomTab: tab, bottomOpen: true }),
  setBottomOpen: (open) => set({ bottomOpen: open }),
  toggleCoverage: () => set((s) => ({ showCoverage: !s.showCoverage })),
  notify: (text, kind = 'info') => set({ notice: { id: ++noticeCounter, text, kind } }),
  clearNotice: () => set({ notice: null }),
  focusDevices: (ids) => set({ focusRequest: { deviceIds: ids, nonce: ++focusCounter }, highlightedDeviceIds: ids }),
  selectAutomation: (id) => set({ selectedAutomationId: id }),
  reset: () => set({ ...initial }),
}));
