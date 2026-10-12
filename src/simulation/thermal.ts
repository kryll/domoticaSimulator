// Modelo de entorno por sala (B13): temperatura con un modelo RC simple e iluminancia según el
// sol y las luces. Se integra en tick mediante applyEnvironment (único punto de llamada).
import type {
  DeviceDefinition,
  EntityState,
  EnvironmentSettings,
  EnvironmentState,
  Id,
  Project,
  RoomEnvironment,
  SimulationState,
} from '../types';
import { entitiesForDevice } from '../devices/entities';
import { hvacAction } from '../devices/climate';
import { DAY_MS, HOUR_MS, minutesOfDay, projectSunLocation, sunTimesAt } from './clock';
import { updateClimateCurrentTemperature } from './services';
import { setEntityState } from './engine';

export const DEFAULT_ENVIRONMENT: Required<EnvironmentSettings> = {
  enabled: true,
  outdoorMean: 12,
  outdoorAmplitude: 5,
  tauHours: 24,
  windowFactor: 6,
  hvacRatePerHour: 2,
};

/** Paso máximo de integración (ms de tiempo simulado). */
export const MAX_STEP_MS = 60_000;
/** Temperatura inicial de una sala sin sensor. */
export const DEFAULT_ROOM_TEMPERATURE = 21;
/** Iluminancia exterior a pleno sol (lx) y fracción que entra por las ventanas. */
export const OUTDOOR_LUX = 20_000;
export const WINDOW_TRANSMISSION = 0.02;
/** Lux que aporta una luz encendida al 100 % en su sala. */
export const LIGHT_LUX = 300;

const CONTACT_CLASSES = new Set(['door', 'window', 'opening', 'garage_door']);

/** Proveedor de amanecer/atardecer del día. */
export type SunProvider = (dayMs: number) => { sunrise: number; sunset: number };

/** Sol real (algoritmo de la NOAA) en la ubicación de los ajustes del proyecto. */
export function projectSunProvider(project: Pick<Project, 'settings'>): SunProvider {
  const where = projectSunLocation(project);
  return (day) => sunTimesAt(day, where);
}

/** Sin proyecto: sol real en la ubicación por defecto (Madrid). */
const defaultSun: SunProvider = projectSunProvider({});

/** Ajustes efectivos del entorno (los del proyecto sobre los valores por defecto). */
export function environmentSettings(project: Pick<Project, 'environment'>): Required<EnvironmentSettings> {
  const e = project.environment;
  const d = DEFAULT_ENVIRONMENT;
  return {
    enabled: e?.enabled ?? false,
    outdoorMean: e?.outdoorMean ?? d.outdoorMean,
    outdoorAmplitude: e?.outdoorAmplitude ?? d.outdoorAmplitude,
    tauHours: e?.tauHours ?? d.tauHours,
    windowFactor: e?.windowFactor ?? d.windowFactor,
    hvacRatePerHour: e?.hvacRatePerHour ?? d.hvacRatePerHour,
  };
}

/** Temperatura exterior senoidal: máximo a las 15:00 y mínimo a las 03:00. */
export function outdoorTemperature(env: Pick<EnvironmentSettings, 'outdoorMean' | 'outdoorAmplitude'>, ms: number): number {
  const hours = minutesOfDay(ms) / 60;
  return env.outdoorMean + env.outdoorAmplitude * Math.cos((2 * Math.PI * (hours - 15)) / 24);
}

/** Factor de luz diurna 0-1: seno entre amanecer y atardecer, 0 de noche. */
export function daylightFactor(ms: number, sun: SunProvider = defaultSun): number {
  const { sunrise, sunset } = sun(ms);
  if (ms <= sunrise || ms >= sunset || sunset <= sunrise) return 0;
  return Math.sin((Math.PI * (ms - sunrise)) / (sunset - sunrise));
}

interface RoomEntities {
  temperature: string[];
  illuminance: string[];
  climate: string[];
  contact: string[];
  lights: string[];
  covers: string[];
}

/** Entidades relevantes de cada sala (por la sala del dispositivo). */
export function roomEntities(project: Project, defs: DeviceDefinition[]): Record<Id, RoomEntities> {
  const result: Record<Id, RoomEntities> = {};
  for (const room of project.rooms) result[room.id] = { temperature: [], illuminance: [], climate: [], contact: [], lights: [], covers: [] };
  for (const device of project.devices) {
    const bucket = device.roomId ? result[device.roomId] : undefined;
    const def = defs.find((d) => d.id === device.definitionId);
    if (!bucket || !def) continue;
    for (const e of entitiesForDevice(device, def)) {
      const { domain, deviceClass } = e.definition;
      if (domain === 'sensor' && deviceClass === 'temperature') bucket.temperature.push(e.entityId);
      else if (domain === 'sensor' && deviceClass === 'illuminance') bucket.illuminance.push(e.entityId);
      else if (domain === 'climate') bucket.climate.push(e.entityId);
      else if (domain === 'binary_sensor' && deviceClass !== undefined && CONTACT_CLASSES.has(deviceClass)) bucket.contact.push(e.entityId);
      else if (domain === 'light') bucket.lights.push(e.entityId);
      else if (domain === 'cover') bucket.covers.push(e.entityId);
    }
  }
  return result;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Estado de entorno inicial: cada sala a la temperatura de su sensor (o 21 °C). */
export function initialEnvironment(project: Project, defs: DeviceDefinition[], sim: SimulationState): EnvironmentState {
  const env = environmentSettings(project);
  const ents = roomEntities(project, defs);
  const rooms: Record<Id, RoomEnvironment> = {};
  for (const room of project.rooms) {
    const sensor = ents[room.id]?.temperature.map((id) => num(sim.entities[id]?.state)).find((x) => x !== undefined);
    rooms[room.id] = { temperature: sensor ?? DEFAULT_ROOM_TEMPERATURE, illuminance: 0 };
  }
  return { outdoorTemperature: outdoorTemperature(env, sim.now), rooms };
}

/** Aporte de calefacción (+) o refrigeración (−) en °C/h de los termostatos de la sala. */
function hvacPower(entities: Record<string, EntityState>, climateIds: string[], temperature: number, rate: number): number {
  let power = 0;
  for (const id of climateIds) {
    const st = entities[id];
    if (!st || st.state === 'unavailable') continue;
    const target = num(st.attributes?.temperature);
    const action = hvacAction(String(st.state), temperature, target);
    if (action === 'heating') power += rate;
    else if (action === 'cooling') power -= rate;
  }
  return power;
}

/**
 * Avanza la temperatura de una sala dtMs con Euler en pasos de como mucho MAX_STEP_MS.
 * Pura: no cambia nada fuera. `fromMs` es la hora al inicio del intervalo.
 */
export function stepRoomTemperature(
  temperature: number,
  fromMs: number,
  dtMs: number,
  env: Required<EnvironmentSettings>,
  opts: { windowOpen: boolean; hvac: (t: number) => number },
): number {
  let t = temperature;
  let now = fromMs;
  let remaining = dtMs;
  const tauMs = Math.max(0.01, env.tauHours) * HOUR_MS;
  while (remaining > 0) {
    const step = Math.min(MAX_STEP_MS, remaining);
    const out = outdoorTemperature(env, now);
    const loss = ((out - t) / tauMs) * (opts.windowOpen ? env.windowFactor : 1);
    t += loss * step + (opts.hvac(t) / HOUR_MS) * step;
    now += step;
    remaining -= step;
  }
  return t;
}

/** Iluminancia de una sala: luz diurna por la ventana (atenuada por las persianas) más las luces. */
export function roomIlluminance(entities: Record<string, EntityState>, ids: RoomEntities, ms: number, sun: SunProvider = defaultSun): number {
  const coverFactor =
    ids.covers.length === 0
      ? 1
      : ids.covers.reduce((acc, id) => acc + (num(entities[id]?.attributes?.current_position) ?? (entities[id]?.state === 'open' ? 100 : 0)), 0) /
        (100 * ids.covers.length);
  let lux = OUTDOOR_LUX * WINDOW_TRANSMISSION * daylightFactor(ms, sun) * coverFactor;
  for (const id of ids.lights) {
    const st = entities[id];
    if (!st || (st.state !== 'on' && st.state !== true)) continue;
    const brightness = num(st.attributes?.brightness);
    lux += LIGHT_LUX * (brightness === undefined ? 1 : brightness / 255);
  }
  return Math.round(lux);
}

/**
 * Aplica el modelo de entorno a la simulación tras avanzar dtMs (sim.now ya es el final del
 * intervalo). Sin project.environment.enabled no hace nada. Actualiza sim.environment, los
 * sensores de temperatura e iluminancia de cada sala (sin registrar los cambios en el
 * logbook, pero disparando automatizaciones) y current_temperature de los termostatos.
 */
export function applyEnvironment(
  sim: SimulationState,
  project: Project,
  defs: DeviceDefinition[],
  dtMs: number,
  sun: SunProvider = projectSunProvider(project),
): SimulationState {
  if (!project.environment?.enabled || !(dtMs > 0)) return sim;
  const env = environmentSettings(project);
  const ents = roomEntities(project, defs);
  const prevEnv = sim.environment ?? initialEnvironment(project, defs, { ...sim, now: sim.now - dtMs });
  const from = sim.now - Math.min(dtMs, 2 * DAY_MS);
  const rooms: Record<Id, RoomEnvironment> = {};
  for (const room of project.rooms) {
    const ids = ents[room.id];
    if (!ids) continue;
    const before = prevEnv.rooms[room.id]?.temperature ?? DEFAULT_ROOM_TEMPERATURE;
    const windowOpen = ids.contact.some((id) => {
      const s = sim.entities[id]?.state;
      return s === 'on' || s === true;
    });
    const temperature = stepRoomTemperature(before, from, sim.now - from, env, {
      windowOpen,
      hvac: (t) => hvacPower(sim.entities, ids.climate, t, env.hvacRatePerHour),
    });
    rooms[room.id] = { temperature, illuminance: roomIlluminance(sim.entities, ids, sim.now, sun) };
  }
  let result: SimulationState = { ...sim, environment: { outdoorTemperature: outdoorTemperature(env, sim.now), rooms } };
  for (const room of project.rooms) {
    const ids = ents[room.id];
    const state = rooms[room.id];
    if (!ids || !state) continue;
    const celsius = Math.round(state.temperature * 10) / 10;
    for (const id of ids.temperature) {
      const current = result.entities[id];
      if (!current || current.state === 'unavailable' || num(current.state) === celsius) continue;
      result = setEntityState(result, project, id, celsius, { quiet: true });
    }
    for (const id of ids.climate) {
      const current = result.entities[id];
      if (!current || current.state === 'unavailable' || num(current.attributes?.current_temperature) === celsius) continue;
      result = setEntityState(result, project, id, updateClimateCurrentTemperature(current, celsius), { quiet: true, replace: true });
    }
    for (const id of ids.illuminance) {
      const current = result.entities[id];
      if (!current || current.state === 'unavailable' || num(current.state) === state.illuminance) continue;
      result = setEntityState(result, project, id, state.illuminance, { quiet: true });
    }
  }
  return result;
}
