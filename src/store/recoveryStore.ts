// Proyecto ilegible detectado al arrancar (bootstrap): lo muestra RecoverProjectDialog.
import { create } from 'zustand';
import type { UnreadableProject } from './bootstrap';

interface RecoveryState {
  unreadable: UnreadableProject | null;
  setUnreadable: (u: UnreadableProject | null) => void;
}

export const useRecoveryStore = create<RecoveryState>((set) => ({
  unreadable: null,
  setUnreadable: (unreadable) => set({ unreadable }),
}));
