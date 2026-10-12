// Estado del puente con el laboratorio (store propio: no toca los del proyecto ni la simulación).
import { create } from 'zustand';
import { pushRing, type LabAction, type SnapshotInfo, type StatusMessage, type TrafficEntry } from './protocol';

export type Connection = 'off' | 'connecting' | 'connected' | 'disconnected';

export interface LabResult {
  action: LabAction;
  ok: boolean;
  message: string;
  at: number;
}

/** Entradas que guarda la pestaña «Tráfico». */
export const TRAFFIC_LIMIT = 3000;

export interface BridgeStoreState {
  connection: Connection;
  /** Modo en vivo: el simulador va a 1x y acoplado al HA del lab. */
  live: boolean;
  /** Motivo del último desacople (pausa, velocidad...). */
  decoupledReason?: string;
  status?: StatusMessage;
  snapshots: SnapshotInfo[];
  /** Operación del lab en curso (por requestId). */
  busy: Partial<Record<LabAction, string>>;
  lastResult?: LabResult;
  traffic: TrafficEntry[];
  trafficPaused: boolean;
  /** Panel del laboratorio abierto (nodos, tráfico, snapshots). */
  panelOpen: boolean;
  panelTab: 'nodes' | 'traffic' | 'snapshots';
  lastError?: string;
  setPanel: (open: boolean, tab?: BridgeStoreState['panelTab']) => void;
  setTrafficPaused: (paused: boolean) => void;
  clearTraffic: () => void;
  addTraffic: (entries: TrafficEntry[]) => void;
}

export const useBridgeStore = create<BridgeStoreState>()((set) => ({
  connection: 'off',
  live: false,
  snapshots: [],
  busy: {},
  traffic: [],
  trafficPaused: false,
  panelOpen: false,
  panelTab: 'nodes',
  setPanel: (open, tab) => set((s) => ({ panelOpen: open, panelTab: tab ?? s.panelTab })),
  setTrafficPaused: (paused) => set({ trafficPaused: paused }),
  clearTraffic: () => set({ traffic: [] }),
  addTraffic: (entries) =>
    set((s) => (s.trafficPaused || entries.length === 0 ? s : { traffic: pushRing(s.traffic, entries, TRAFFIC_LIMIT) })),
}));
