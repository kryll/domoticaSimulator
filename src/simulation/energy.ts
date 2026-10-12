// Energía y baterías (B10): potencia por dispositivo según su estado, acumulación de kWh,
// coste y descarga de baterías. Funciones puras; el motor (tick) las aplica.
import type { Device, DeviceDefinition, EnergyState, EntityState, Id, Project, ProjectSettings, SimulationState } from '../types';
import { defaultSettings } from '../types';
import { entitiesForDevice } from '../devices/entities';
import { HOUR_MS } from './clock';
import { activeFailures, needsMains } from './connectivity';
import { toNumber } from './stateUtils';

/** Nivel de batería por debajo del cual se avisa. */
export const LOW_BATTERY_LEVEL = 20;

/** Carga por defecto de un enchufe o relé encendido si el dispositivo no indica loadWatts. */
export const DEFAULT_LOAD_WATTS: Record<'plug' | 'switch', number> = { plug: 60, switch: 40 };

/** Consumo en reposo (W) por categoría de los equipos alimentados. */
const STANDBY_WATTS: Record<DeviceDefinition['category'], number> = {
  light: 0.3,
  plug: 0.5,
  switch: 0.5,
  sensor: 1.5,
  climate: 0.5,
  cover: 0.5,
  lock: 0.2,
  camera: 6,
  speaker: 3,
  display: 3,
  vacuum: 3,
  hub: 3,
  network: 10,
  server: 5,
};

/** Coordinadores USB: consumo mínimo. */
const COORDINATOR_WATTS = 0.5;
const COVER_MOTOR_WATTS = 120;
const TV_BRANDS = new Set(['Samsung', 'LG']);

/** Horas de autonomía aproximadas (a factor de aceleración 1) por categoría. */
const BATTERY_LIFE_HOURS: Partial<Record<DeviceDefinition['category'], number>> = {
  sensor: 2 * 8760,
  switch: 2 * 8760,
  lock: 8 * 730,
  climate: 8760,
  cover: 6 * 730,
};
const DEFAULT_BATTERY_LIFE_HOURS = 1.5 * 8760;

export function projectSettings(project: Pick<Project, 'settings'>): ProjectSettings {
  return { ...defaultSettings(), ...project.settings };
}

/** Porcentaje que pierde la batería por hora simulada (con el factor de aceleración). */
export function batteryDrainPerHour(def: DeviceDefinition, acceleration = 1): number {
  const life = BATTERY_LIFE_HOURS[def.category] ?? DEFAULT_BATTERY_LIFE_HOURS;
  return (100 / life) * Math.max(0, acceleration);
}

function states(device: Device, def: DeviceDefinition, entities: Record<string, EntityState>): { domain: string; st: EntityState | undefined; watts?: number }[] {
  return entitiesForDevice(device, def).map((e) => {
    const item: { domain: string; st: EntityState | undefined; watts?: number } = { domain: e.definition.domain, st: entities[e.entityId] };
    const w = e.definition.capabilities?.powerWatts;
    if (w !== undefined) item.watts = w;
    return item;
  });
}

/**
 * Carga que alimenta el dispositivo (sin su propio consumo en reposo): lo que mide el sensor
 * `power` de un enchufe o relé, el motor de una persiana, la bombilla encendida...
 */
export function loadWatts(device: Device, def: DeviceDefinition, entities: Record<string, EntityState>): number {
  let total = 0;
  for (const { domain, st, watts } of states(device, def, entities)) {
    if (!st || st.state === 'unavailable') continue;
    const s = String(st.state);
    switch (domain) {
      case 'light': {
        if (s !== 'on') break;
        const nominal = watts ?? 9;
        const brightness = toNumber(st.attributes?.brightness);
        const ratio = brightness === undefined ? 1 : Math.max(0.1, Math.min(1, brightness / 255));
        total += nominal * ratio;
        break;
      }
      case 'switch': {
        if (s !== 'on') break;
        const fallback = def.category === 'plug' ? DEFAULT_LOAD_WATTS.plug : DEFAULT_LOAD_WATTS.switch;
        const load = device.loadWatts ?? fallback;
        total += watts === undefined ? load : Math.min(load, watts);
        break;
      }
      case 'fan':
        if (s === 'on') total += (watts ?? 40) * ((toNumber(st.attributes?.percentage) ?? 100) / 100);
        break;
      case 'cover':
        if (s === 'opening' || s === 'closing') total += watts ?? COVER_MOTOR_WATTS;
        break;
      case 'media_player': {
        const tv = def.category === 'display' && TV_BRANDS.has(def.brand);
        if (s === 'off') break;
        const active = s === 'playing' ? 1 : 0.6;
        total += (watts ?? (tv ? 90 : def.category === 'speaker' ? 8 : 4)) * (tv ? 1 : active);
        break;
      }
      case 'vacuum':
        if (s === 'cleaning') total += watts ?? 45;
        else if (s === 'returning') total += 30;
        break;
      case 'camera':
        if (s === 'recording') total += 1.5;
        break;
      default:
        break;
    }
  }
  return total;
}

/** Consumo en reposo del propio dispositivo (0 si va a pilas). */
export function standbyWatts(def: DeviceDefinition): number {
  if (def.power === 'battery') return 0;
  if (def.role === 'coordinator') return COORDINATOR_WATTS;
  return STANDBY_WATTS[def.category];
}

/**
 * Estado físico de las entidades del dispositivo: si está no disponible por la red, la nube o
 * una desconexión, sus cargas siguen como estaban (estado guardado en sim.offline).
 */
export function physicalEntities(sim: Pick<SimulationState, 'entities' | 'offline'>, deviceId: Id): Record<string, EntityState> {
  const saved = sim.offline?.[deviceId];
  return saved ? { ...sim.entities, ...saved } : sim.entities;
}

/**
 * Potencia total (W) del dispositivo ahora: reposo + carga. Solo el corte de luz (sin SAI) la
 * pone a 0; un dispositivo no disponible por la red o la nube sigue consumiendo su carga.
 */
export function devicePowerWatts(device: Device, def: DeviceDefinition, sim: Pick<SimulationState, 'entities' | 'failures' | 'offline'>): number {
  if (def.power === 'battery') return 0;
  if (activeFailures(sim).powerOutage && needsMains(def) && device.ups !== true) return 0;
  return standbyWatts(def) + loadWatts(device, def, physicalEntities(sim, device.id));
}

export interface EnergyStep {
  energy: EnergyState;
  batteries: Record<Id, number>;
  /** Dispositivos que bajan del 20 % en este paso. */
  lowCrossed: Id[];
  /** Dispositivos que llegan al 0 % en este paso. */
  depleted: Id[];
}

/** Nivel inicial de la batería: el estado inicial de su sensor battery o 100 %. */
export function initialBatteryLevel(device: Device, def: DeviceDefinition, entities: Record<string, EntityState>): number {
  const battery = entitiesForDevice(device, def).find((e) => e.definition.deviceClass === 'battery');
  const v = battery ? toNumber(entities[battery.entityId]?.state) : undefined;
  return v ?? 100;
}

/**
 * Acumula energía y descarga baterías durante `ms` milisegundos con el estado actual (que se
 * supone constante en ese intervalo). No cambia entidades: el motor refleja los resultados.
 */
export function energyStep(sim: SimulationState, project: Project, defs: DeviceDefinition[], ms: number): EnergyStep {
  const energy: EnergyState = sim.energy ? { since: sim.energy.since, kwhByDevice: { ...sim.energy.kwhByDevice } } : { since: sim.now, kwhByDevice: {} };
  const batteries: Record<Id, number> = { ...sim.batteries };
  const lowCrossed: Id[] = [];
  const depleted: Id[] = [];
  if (!(ms > 0)) return { energy, batteries, lowCrossed, depleted };
  const hours = ms / HOUR_MS;
  const acceleration = projectSettings(project).batteryAcceleration ?? 1;
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) continue;
    const watts = devicePowerWatts(device, def, sim);
    if (watts > 0) energy.kwhByDevice[device.id] = (energy.kwhByDevice[device.id] ?? 0) + (watts * hours) / 1000;
    if (def.power !== 'battery') continue;
    const before = batteries[device.id] ?? initialBatteryLevel(device, def, sim.entities);
    if (before <= 0) {
      batteries[device.id] = 0;
      continue;
    }
    const after = Math.max(0, before - batteryDrainPerHour(def, acceleration) * hours);
    batteries[device.id] = after;
    if (before >= LOW_BATTERY_LEVEL && after < LOW_BATTERY_LEVEL) lowCrossed.push(device.id);
    if (after <= 0) depleted.push(device.id);
  }
  return { energy, batteries, lowCrossed, depleted };
}

// ---------- Resumen ----------

export interface DeviceEnergy {
  deviceId: Id;
  name: string;
  watts: number;
  kwh: number;
  cost: number;
}

export interface RoomEnergy {
  /** null: dispositivos sin sala. */
  roomId: Id | null;
  name: string;
  watts: number;
  kwh: number;
  cost: number;
}

export interface EnergySummary {
  totalW: number;
  byDevice: DeviceEnergy[];
  byRoom: RoomEnergy[];
  totalKwh: number;
  totalCost: number;
  /** €/kWh usado en el cálculo. */
  pricePerKwh: number;
  /** Desde cuándo se acumula (hora simulada). */
  since: number;
  lowBatteries: { deviceId: Id; level: number }[];
}

const round = (n: number, decimals: number): number => Math.round(n * 10 ** decimals) / 10 ** decimals;

/** Potencia actual, energía acumulada, coste y baterías bajas del proyecto. */
export function energySummary(sim: SimulationState, project: Project, defs: DeviceDefinition[]): EnergySummary {
  const price = projectSettings(project).electricityPriceEurKwh;
  const byDevice: DeviceEnergy[] = [];
  const rooms = new Map<string, RoomEnergy>();
  const lowBatteries: { deviceId: Id; level: number }[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) continue;
    const watts = devicePowerWatts(device, def, sim);
    const kwh = sim.energy?.kwhByDevice[device.id] ?? 0;
    const cost = kwh * price;
    byDevice.push({ deviceId: device.id, name: device.name, watts: round(watts, 2), kwh, cost });
    const room = project.rooms.find((r) => r.id === device.roomId);
    const key = room?.id ?? '';
    const agg = rooms.get(key) ?? { roomId: room?.id ?? null, name: room?.name ?? 'Sin sala', watts: 0, kwh: 0, cost: 0 };
    rooms.set(key, { ...agg, watts: round(agg.watts + watts, 2), kwh: agg.kwh + kwh, cost: agg.cost + cost });
    if (def.power === 'battery') {
      const level = sim.batteries?.[device.id] ?? initialBatteryLevel(device, def, sim.entities);
      if (level < LOW_BATTERY_LEVEL) lowBatteries.push({ deviceId: device.id, level: round(level, 1) });
    }
  }
  const totalKwh = byDevice.reduce((s, d) => s + d.kwh, 0);
  return {
    totalW: round(byDevice.reduce((s, d) => s + d.watts, 0), 2),
    byDevice: byDevice.sort((a, b) => b.watts - a.watts || b.kwh - a.kwh),
    byRoom: [...rooms.values()].sort((a, b) => b.kwh - a.kwh || b.watts - a.watts),
    totalKwh,
    totalCost: totalKwh * price,
    pricePerKwh: price,
    since: sim.energy?.since ?? sim.startedAt ?? sim.now,
    lowBatteries: lowBatteries.sort((a, b) => a.level - b.level),
  };
}

/** Pone a cero los contadores de energía (desde ahora). */
export function resetEnergy(sim: SimulationState): SimulationState {
  return { ...sim, energy: { since: sim.now, kwhByDevice: {} } };
}
