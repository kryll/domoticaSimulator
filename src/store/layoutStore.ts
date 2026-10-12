// Estado de interfaz de la Tanda 3: cajones del móvil, paleta de comandos y diálogos nuevos.
import { create } from 'zustand';
import type { Id } from '../types';

/** Panel lateral abierto como cajón en pantallas estrechas. */
export type MobileDrawer = 'catalog' | 'properties';

/** Editor de dispositivos personalizados: nuevo, clonando uno o editando uno existente. */
export type CustomDeviceEditorState = { mode: 'new' } | { mode: 'clone'; definitionId: Id } | { mode: 'edit'; definitionId: Id };

export interface LayoutState {
  drawer: MobileDrawer | null;
  paletteOpen: boolean;
  importHaOpen: boolean;
  customDevice: CustomDeviceEditorState | null;
  dayPlanOpen: boolean;
  setDrawer: (drawer: MobileDrawer | null) => void;
  setPaletteOpen: (open: boolean) => void;
  setImportHaOpen: (open: boolean) => void;
  openCustomDevice: (state: CustomDeviceEditorState | null) => void;
  setDayPlanOpen: (open: boolean) => void;
  reset: () => void;
}

const initial = {
  drawer: null,
  paletteOpen: false,
  importHaOpen: false,
  customDevice: null,
  dayPlanOpen: false,
};

export const useLayoutStore = create<LayoutState>()((set) => ({
  ...initial,
  setDrawer: (drawer) => set({ drawer }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setImportHaOpen: (importHaOpen) => set({ importHaOpen }),
  openCustomDevice: (customDevice) => set({ customDevice }),
  setDayPlanOpen: (dayPlanOpen) => set({ dayPlanOpen }),
  reset: () => set({ ...initial }),
}));
