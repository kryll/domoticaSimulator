// Hooks de React del puente con el laboratorio.
import { useMemo } from 'react';
import { useBridgeStore } from './bridgeStore';
import { activeNativeTransports, type NativeTransport } from './native';
import { useProjectStore } from '../store/projectStore';
import { bridgeSettings } from './schema';
import type { HaBridgeSettings } from '../types';

/** ¿Está el simulador en modo en vivo con el lab? */
export function useBridgeLive(): boolean {
  return useBridgeStore((s) => s.live);
}

/** Ajustes del puente del proyecto (topics y automatizaciones, con valores por defecto). */
export function useBridgeSettings(): HaBridgeSettings {
  const stored = useProjectStore((s) => s.project.haBridge);
  return bridgeSettings({ haBridge: stored });
}

/** Cambia los ajustes del puente del proyecto (con deshacer). */
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

/**
 * Vías reales activas en el orquestador (perfiles zwave, esphome y shelly, de `status.capabilities`):
 * con ellas, los dispositivos Z-Wave, ESPHome y Shelly llegan a HA por su integración real.
 */
export function useActiveNative(): ReadonlySet<NativeTransport> {
  const zwave = useBridgeStore((s) => s.status?.capabilities?.zwave === true);
  const esphome = useBridgeStore((s) => s.status?.capabilities?.esphome === true);
  const shelly = useBridgeStore((s) => s.status?.capabilities?.shelly === true);
  return useMemo(() => activeNativeTransports({ zwave, esphome, shelly }), [zwave, esphome, shelly]);
}
