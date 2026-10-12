// Potencia y batería de cada nodo del lienzo, con un selector propio por dispositivo: cambian
// con la energía y las baterías del motor (sim.energy, sim.batteries) en cada tick, así que no
// van en los datos de los nodos (eso obligaría a reconstruir y repintar todo el lienzo).
import type { Device, DeviceDefinition, SimulationState } from '../types';
import { devicePowerWatts, loadWatts } from '../simulation/energy';
import { entitiesForDevice } from '../devices/entities';

export interface NodePower {
  /** Potencia que consume ahora (W), solo si tiene carga activa. */
  watts?: number;
  /** Nivel de batería (%) de los dispositivos a pilas. */
  batteryPct?: number;
}

type PowerSim = Pick<SimulationState, 'entities' | 'failures' | 'offline' | 'batteries'>;

/**
 * Clave primitiva de los indicadores ("w:12", "b:80" o ""): el selector devuelve un texto, así el
 * nodo solo se vuelve a pintar cuando cambia lo que se ve (vatios o porcentaje redondeados).
 */
export function nodePowerKey(device: Device, def: DeviceDefinition | undefined, sim: PowerSim): string {
  if (!def) return '';
  if (def.power === 'battery') {
    const live = sim.batteries?.[device.id];
    let level = live;
    if (level === undefined) {
      const refs = entitiesForDevice(device, def);
      const battery = refs.find((r) => r.definition.deviceClass === 'battery');
      const raw = battery ? sim.entities[battery.entityId]?.state : refs.map((r) => sim.entities[r.entityId]?.attributes?.battery_level).find((v) => v !== undefined);
      level = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    }
    return Number.isFinite(level) ? `b:${Math.round(level ?? 0)}` : '';
  }
  if (loadWatts(device, def, sim.entities) <= 0) return '';
  const watts = Math.round(devicePowerWatts(device, def, sim));
  return watts > 0 ? `w:${watts}` : '';
}

export function parseNodePower(key: string): NodePower {
  const n = Number(key.slice(2));
  if (key.startsWith('w:')) return { watts: n };
  if (key.startsWith('b:')) return { batteryPct: n };
  return {};
}
