import { create } from 'zustand';

interface PwaState {
  /** Hay un service worker nuevo instalado y esperando. */
  updateReady: boolean;
  /** Activa la versión nueva y recarga la página. */
  applyUpdate: (() => void) | null;
  setUpdate: (apply: (() => void) | null) => void;
  dismiss: () => void;
}

export const usePwaStore = create<PwaState>()((set) => ({
  updateReady: false,
  applyUpdate: null,
  setUpdate: (apply) => set({ updateReady: apply !== null, applyUpdate: apply }),
  dismiss: () => set({ updateReady: false }),
}));
