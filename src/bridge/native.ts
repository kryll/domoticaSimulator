// Vías reales de E2 y E3 (Z-Wave JS, ESPHome y Shelly): qué dispositivos llegan a HA por su
// integración real y cuáles siguen por MQTT (perfil desactivado o dispositivo no emulable). Lógica
// pura compartida por la app y el orquestador.
import { PROFILE_TRANSPORTS, transportFor, type Device, type DeviceDefinition, type DeviceTransport, type Id, type LabProfile, type Project } from '../types';
import { allDefinitions } from '../devices/catalog';
import { zwaveSupport } from './zwave/plan';
import { esphomeSupport } from './esphome/plan';
import { shellySupport } from './shelly/plan';

export type NativeTransport = 'zwave_js' | 'esphome' | 'shelly';

export const NATIVE_TRANSPORTS: readonly NativeTransport[] = ['zwave_js', 'esphome', 'shelly'];

export interface NativeDecision {
  transport: DeviceTransport;
  /** Llega a HA por su integración real. */
  native: boolean;
  /** Perfil del laboratorio que necesita su vía real. */
  profile?: LabProfile;
  /** Por qué no va por la vía real (perfil desactivado o no emulable). */
  reason?: string;
}

/** Vías reales activas según las capacidades que anuncia el orquestador en `status`. */
export function activeNativeTransports(capabilities: { zwave?: boolean; esphome?: boolean; shelly?: boolean } | undefined): Set<NativeTransport> {
  const out = new Set<NativeTransport>();
  if (capabilities?.zwave) out.add('zwave_js');
  if (capabilities?.esphome) out.add('esphome');
  if (capabilities?.shelly) out.add('shelly');
  return out;
}

export function isNativeTransport(t: DeviceTransport): t is NativeTransport {
  return t === 'zwave_js' || t === 'esphome' || t === 'shelly';
}

/** ¿Llega este dispositivo a HA por su vía real con las vías activas? */
export function nativeDecision(device: Device, def: DeviceDefinition, active: ReadonlySet<NativeTransport>): NativeDecision {
  const transport = transportFor(device, def);
  const profile = PROFILE_TRANSPORTS[transport];
  if (!isNativeTransport(transport) || profile === undefined) return { transport, native: false };
  if (!active.has(transport)) return { transport, native: false, profile, reason: `el perfil «${profile}» del laboratorio no está activo (setup.sh --${profile})` };
  const support = transport === 'zwave_js' ? zwaveSupport(device, def) : transport === 'shelly' ? shellySupport(device, def) : esphomeSupport(device, def);
  if (!support.ok) return { transport, native: false, profile, reason: support.reason };
  return { transport, native: true, profile };
}

/** Dispositivos del proyecto que van por una vía real (no se publican por MQTT). */
export function nativeDevices(project: Project, baseDefs: DeviceDefinition[], active: ReadonlySet<NativeTransport>): Map<Id, NativeTransport> {
  const out = new Map<Id, NativeTransport>();
  if (active.size === 0) return out;
  const defs = allDefinitions(project, baseDefs);
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def || def.role === 'ha_server') continue;
    const d = nativeDecision(device, def, active);
    if (d.native && isNativeTransport(d.transport)) out.set(device.id, d.transport);
  }
  return out;
}
