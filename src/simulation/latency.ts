// Latencia y fiabilidad por protocolo e integración (B22). Funciones puras y deterministas.
import type { DeviceDefinition, Integration, Project, Protocol } from '../types';
import { findEntityOwner } from '../devices/capabilities';
import { isCloud, allDefinitions } from '../devices/catalog';
import { effectiveIotClass } from '../devices/roles';

/** Latencia base de una integración local (ms). */
export const LOCAL_LATENCY_MS = 100;
/** Rango de latencia de una integración en la nube (ms). */
export const CLOUD_LATENCY_MIN_MS = 1000;
export const CLOUD_LATENCY_MAX_MS = 3000;

/** Latencia extra por protocolo de radio (ms): saltos de malla, sondeo, etc. */
export const PROTOCOL_LATENCY_MS: Record<Protocol, number> = {
  wifi: 20,
  ethernet: 5,
  zigbee: 40,
  zwave: 60,
  thread: 30,
  matter: 30,
  ble: 80,
  rf433: 50,
};

/** Latencia extra por integración local conocida por sondear (polling) en lugar de push. */
export const INTEGRATION_LATENCY_MS: Partial<Record<Integration, number>> = {
  xiaomi_miio: 200,
  tplink: 150,
};

export interface LatencyInfo {
  ms: number;
  cloud: boolean;
}

/** Generador mulberry32: devuelve [valor en [0, 1), nuevo estado]. */
export function nextRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/**
 * Latencia de una llamada a la entidad. `random` en [0, 1) sitúa la latencia de nube dentro de
 * su rango (1-3 s). Entidades sin dispositivo (grupos, personas): latencia 0, local.
 */
export function latencyFor(project: Pick<Project, 'devices' | 'customDefinitions'>, defs: DeviceDefinition[], entityId: string, random = 0.5): LatencyInfo {
  defs = allDefinitions(project, defs);
  const owner = findEntityOwner(project, entityId, defs);
  if (!owner) return { ms: 0, cloud: false };
  const cloud = isCloud(effectiveIotClass(owner.device, owner.def));
  const radio = PROTOCOL_LATENCY_MS[owner.device.protocol];
  if (cloud) return { ms: Math.round(CLOUD_LATENCY_MIN_MS + random * (CLOUD_LATENCY_MAX_MS - CLOUD_LATENCY_MIN_MS) + radio), cloud };
  return { ms: LOCAL_LATENCY_MS + radio + (INTEGRATION_LATENCY_MS[owner.device.integration] ?? 0), cloud };
}
