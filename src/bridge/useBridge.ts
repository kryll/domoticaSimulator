// Hooks de React del puente con el laboratorio.
import { useBridgeStore } from './bridgeStore';
import { useProjectStore } from '../store/projectStore';
import { defaultHaBridgeSettings, type HaBridgeSettings, type Project } from '../types';

function bridgeSettings(p: Pick<Project, 'haBridge'>): HaBridgeSettings {
  return { ...defaultHaBridgeSettings(), ...p.haBridge };
}

/** ¿Está el simulador en modo en vivo con el lab? */
export function useBridgeLive(): boolean {
  return useBridgeStore((s) => s.live);
}

/** Ajustes del puente del proyecto (con valores por defecto). */
export function useBridgeSettings(): HaBridgeSettings {
  const stored = useProjectStore((s) => s.project.haBridge);
  return bridgeSettings({ haBridge: stored });
}

/** Cambia los ajustes del puente (con deshacer). */
export function updateBridgeSettings(patch: Partial<HaBridgeSettings>): void {
  useProjectStore.getState().update((p) => ({ ...p, haBridge: { ...bridgeSettings(p), ...patch } }));
}

/** ¿Está el simulador en modo en vivo con el lab? (fuera de React). */
export function isBridgeLive(): boolean {
  return useBridgeStore.getState().live;
}

export function useBridge() {
  const connection = useBridgeStore((s) => s.connection);
  const live = useBridgeStore((s) => s.live);
  const status = useBridgeStore((s) => s.status);
  return { connection, live, status };
}
