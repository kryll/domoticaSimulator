// Estado de interfaz de la Tanda 2: primera experiencia (bienvenida, guía y tour), modo
// presentación, editor de automatizaciones grande, propuesta y preferencias del lienzo.
// Las preferencias del lienzo se recuerdan en localStorage (siempre con try/catch).
import { create } from 'zustand';
import type { Id } from '../types';

/** Qué conexiones se dibujan en el lienzo. */
export type ConnectionsLayer = 'all' | 'selected' | 'none';

/** Vista del modo presentación. */
export type PresentationView = 'plan' | 'dashboard' | 'scenarios';

const PREFIX = 'ha-simulator:';
export const PREF_KEYS = {
  minimap: `${PREFIX}minimap`,
  legend: `${PREFIX}legend`,
  layerLegend: `${PREFIX}layer-legend`,
  connections: `${PREFIX}connections-layer`,
  tourDone: `${PREFIX}tour-done`,
  welcomeDone: `${PREFIX}welcome-done`,
  automationsDocked: `${PREFIX}automations-docked`,
} as const;

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento local (modo privado, bloqueado): la preferencia dura solo esta sesión.
  }
}

function readBool(key: string, fallback: boolean): boolean {
  const v = readPref(key);
  return v === null ? fallback : v === '1';
}

function readLayer(): ConnectionsLayer {
  const v = readPref(PREF_KEYS.connections);
  return v === 'selected' || v === 'none' ? v : 'all';
}

export interface ViewState {
  showMinimap: boolean;
  showLegend: boolean;
  showLayerLegend: boolean;
  connectionsLayer: ConnectionsLayer;
  /** Paso del tour (0..4) o null si no está abierto. */
  tourStep: number | null;
  welcomeOpen: boolean;
  /** Proyecto en el que se empezó la guía de primeros pasos (se sigue mostrando hasta terminarla). */
  guideProjectId: Id | null;
  /** Pasos marcados a mano en la guía. */
  guideManual: Record<string, boolean>;
  guideDismissed: Id | null;
  presentation: boolean;
  presentationView: PresentationView;
  /** Editor de automatizaciones en el panel grande (modal). */
  automationsModal: boolean;
  /** Preferencia: editor acoplado al panel inferior en vez del panel grande. */
  automationsDocked: boolean;
  proposalOpen: boolean;

  setShowMinimap: (v: boolean) => void;
  setShowLegend: (v: boolean) => void;
  setShowLayerLegend: (v: boolean) => void;
  setConnectionsLayer: (v: ConnectionsLayer) => void;
  startTour: () => void;
  setTourStep: (step: number | null) => void;
  /** Cierra el tour (terminado o saltado) y lo recuerda. */
  endTour: () => void;
  setWelcomeOpen: (open: boolean) => void;
  startGuide: (projectId: Id) => void;
  toggleGuideStep: (step: string) => void;
  dismissGuide: (projectId: Id) => void;
  setPresentation: (on: boolean) => void;
  setPresentationView: (view: PresentationView) => void;
  setAutomationsModal: (open: boolean) => void;
  setAutomationsDocked: (docked: boolean) => void;
  setProposalOpen: (open: boolean) => void;
  reset: () => void;
}

function initialState() {
  return {
    showMinimap: readBool(PREF_KEYS.minimap, true),
    showLegend: readBool(PREF_KEYS.legend, true),
    showLayerLegend: readBool(PREF_KEYS.layerLegend, true),
    connectionsLayer: readLayer(),
    tourStep: null,
    welcomeOpen: false,
    guideProjectId: null,
    guideManual: {},
    guideDismissed: null,
    presentation: false,
    presentationView: 'plan' as PresentationView,
    automationsModal: false,
    automationsDocked: readBool(PREF_KEYS.automationsDocked, false),
    proposalOpen: false,
  };
}

export const TOUR_STEPS = 5;

export const useViewStore = create<ViewState>()((set) => ({
  ...initialState(),
  setShowMinimap: (showMinimap) => {
    writePref(PREF_KEYS.minimap, showMinimap ? '1' : '0');
    set({ showMinimap });
  },
  setShowLegend: (showLegend) => {
    writePref(PREF_KEYS.legend, showLegend ? '1' : '0');
    set({ showLegend });
  },
  setShowLayerLegend: (showLayerLegend) => {
    writePref(PREF_KEYS.layerLegend, showLayerLegend ? '1' : '0');
    set({ showLayerLegend });
  },
  setConnectionsLayer: (connectionsLayer) => {
    writePref(PREF_KEYS.connections, connectionsLayer);
    set({ connectionsLayer });
  },
  startTour: () => set({ tourStep: 0, welcomeOpen: false }),
  setTourStep: (tourStep) => set({ tourStep }),
  endTour: () => {
    writePref(PREF_KEYS.tourDone, '1');
    set({ tourStep: null });
  },
  setWelcomeOpen: (welcomeOpen) => set({ welcomeOpen }),
  startGuide: (projectId) => set((s) => (s.guideProjectId === projectId ? s : { guideProjectId: projectId, guideManual: {} })),
  toggleGuideStep: (step) => set((s) => ({ guideManual: { ...s.guideManual, [step]: !s.guideManual[step] } })),
  dismissGuide: (projectId) => set({ guideDismissed: projectId, guideProjectId: null }),
  setPresentation: (presentation) => set({ presentation, ...(presentation ? { presentationView: 'plan' as PresentationView, automationsModal: false } : {}) }),
  setPresentationView: (presentationView) => set({ presentationView }),
  setAutomationsModal: (automationsModal) => set({ automationsModal }),
  setAutomationsDocked: (automationsDocked) => {
    writePref(PREF_KEYS.automationsDocked, automationsDocked ? '1' : '0');
    set({ automationsDocked, automationsModal: !automationsDocked });
  },
  setProposalOpen: (proposalOpen) => set({ proposalOpen }),
  reset: () => set(initialState()),
}));

/** ¿Ya se hizo (o se saltó) el tour? */
export function tourDone(): boolean {
  return readPref(PREF_KEYS.tourDone) === '1';
}

/** ¿Ya se mostró la bienvenida (demo o en blanco)? */
export function welcomeDone(): boolean {
  return readPref(PREF_KEYS.welcomeDone) === '1';
}

export function markWelcomeDone(): void {
  writePref(PREF_KEYS.welcomeDone, '1');
}
