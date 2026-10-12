// Estado de interfaz de las funciones de la Fase 3 (diálogos, capas del lienzo, paredes).
// Va aparte de uiStore para no mezclarlo con el estado básico del lienzo.
import { create } from 'zustand';
import type { Id, Point, Protocol, WallMaterial } from '../types';

export type CenterView = 'plan' | 'dashboard';

export type ExtraDialog = 'houseTemplates' | 'packages' | 'share';

export interface RouterSuggestion {
  floorId: Id;
  points: Array<{ position: Point; reason: string }>;
}

/** Protocolos que se pueden ver en la capa «Señal». */
export type SignalProtocol = Extract<Protocol, 'wifi' | 'zigbee' | 'thread' | 'zwave'>;

export interface FloorMenuState {
  floorId: Id;
  x: number;
  y: number;
}

export interface ExtrasState {
  dialog: ExtraDialog | null;
  /** Menú «Escenarios de fallo» abierto (desde su botón o desde «☰ Proyecto»). */
  scenariosOpen: boolean;
  /** Vista del área central: plano o dashboard. */
  centerView: CenterView;
  /** Capa «Clima»: temperatura por sala. */
  showClimate: boolean;
  /** Capa «Señal»: mapa de calor RSSI. */
  showSignal: boolean;
  signalProtocol: SignalProtocol;
  /** Material de las paredes nuevas en el modo «Dibujar pared». */
  wallMaterial: WallMaterial;
  /** Posiciones propuestas por «Sugerir router». */
  routerSuggestion: RouterSuggestion | null;
  notificationsOpen: boolean;
  /** Menú contextual de la planta (clic derecho en el fondo del lienzo o en la pestaña de planta). */
  floorMenu: FloorMenuState | null;

  openDialog: (dialog: ExtraDialog | null) => void;
  setScenariosOpen: (open: boolean) => void;
  setCenterView: (view: CenterView) => void;
  toggleClimate: () => void;
  toggleSignal: () => void;
  setSignalProtocol: (p: SignalProtocol) => void;
  setWallMaterial: (material: WallMaterial) => void;
  setRouterSuggestion: (s: RouterSuggestion | null) => void;
  setNotificationsOpen: (open: boolean) => void;
  openFloorMenu: (menu: FloorMenuState | null) => void;
  reset: () => void;
}

const initial = {
  dialog: null,
  scenariosOpen: false,
  centerView: 'plan' as CenterView,
  showClimate: false,
  showSignal: false,
  signalProtocol: 'zigbee' as SignalProtocol,
  wallMaterial: 'brick' as WallMaterial,
  routerSuggestion: null,
  notificationsOpen: false,
  floorMenu: null,
};

export const useExtrasStore = create<ExtrasState>()((set) => ({
  ...initial,
  openDialog: (dialog) => set({ dialog }),
  setScenariosOpen: (scenariosOpen) => set({ scenariosOpen }),
  setCenterView: (centerView) => set({ centerView }),
  toggleClimate: () => set((s) => ({ showClimate: !s.showClimate })),
  toggleSignal: () => set((s) => ({ showSignal: !s.showSignal })),
  setSignalProtocol: (signalProtocol) => set({ signalProtocol }),
  setWallMaterial: (wallMaterial) => set({ wallMaterial }),
  setRouterSuggestion: (routerSuggestion) => set({ routerSuggestion }),
  setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
  openFloorMenu: (floorMenu) => set({ floorMenu }),
  reset: () => set({ ...initial }),
}));
