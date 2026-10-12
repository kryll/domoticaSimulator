// Atajos para simular eventos físicos desde la interfaz o los tests.
import type { EntityState, Id, Project, SimulationState } from '../types';
import { catalog } from '../devices/catalog';
import { entityCapabilities } from '../devices/capabilities';
import { entitiesForDevice } from '../devices/entities';
import { appendLog, cancelTimer, entityTimerKey, scheduleTimer, setEntityState } from './engine';
import { SECOND_MS } from './clock';

function warn(sim: SimulationState, message: string, entityId?: string): SimulationState {
  return appendLog(sim, 'warning', message, entityId === undefined ? {} : { entityId });
}

const MOTION_CLASSES = new Set(['motion', 'occupancy', 'presence']);

function isUnavailable(sim: SimulationState, entityId: string): boolean {
  return sim.entities[entityId]?.state === 'unavailable';
}

/**
 * Pulso de movimiento: pasa a 'on' y vuelve a 'off' a los `seconds` (por defecto los
 * motionTimeoutSeconds del modelo, 60 s si no constan). Otro pulso reinicia la cuenta.
 */
export function motionPulse(sim: SimulationState, project: Project, entityId: string, seconds?: number): SimulationState {
  const stop = blocked(sim, entityId, 'el movimiento');
  if (stop) return stop;
  const timeout = seconds ?? entityCapabilities(project, entityId).motionTimeoutSeconds ?? 60;
  const on = setEntityState(sim, project, entityId, 'on');
  return scheduleTimer(on, entityTimerKey(entityId), on.now + Math.max(0, timeout) * SECOND_MS, {
    kind: 'set_states',
    setStates: { [entityId]: { state: 'off' } },
    reason: 'sin movimiento',
  });
}

/**
 * Movimiento detectado (con autoapagado según el modelo) o dejado de detectar (off inmediato).
 */
export function triggerMotion(sim: SimulationState, project: Project, entityId: string, detected = true): SimulationState {
  if (detected) return motionPulse(sim, project, entityId);
  return setEntityState(cancelTimer(sim, entityTimerKey(entityId)), project, entityId, 'off');
}

/** Aviso si la entidad no existe o no está disponible (un evento físico no la cambia). */
function blocked(sim: SimulationState, entityId: string, what: string): SimulationState | undefined {
  if (!sim.entities[entityId]) return warn(sim, `Entidad desconocida: ${entityId}`, entityId);
  if (isUnavailable(sim, entityId)) return warn(sim, `${entityId} no está disponible: se ignora ${what}`, entityId);
  return undefined;
}

/** Abre (on) o cierra (off) un sensor de puerta/ventana. */
export function openDoor(sim: SimulationState, project: Project, entityId: string, open = true): SimulationState {
  return blocked(sim, entityId, open ? 'la apertura' : 'el cierre') ?? setEntityState(sim, project, entityId, open ? 'on' : 'off');
}

export function closeDoor(sim: SimulationState, project: Project, entityId: string): SimulationState {
  return openDoor(sim, project, entityId, false);
}

/** Fuga de agua detectada (on) o seca (off). */
export function setLeak(sim: SimulationState, project: Project, entityId: string, wet = true): SimulationState {
  return blocked(sim, entityId, 'la fuga') ?? setEntityState(sim, project, entityId, wet ? 'on' : 'off');
}

/** Fija la lectura de un sensor de temperatura (redondeada a una décima). */
export function setTemperature(sim: SimulationState, project: Project, entityId: string, celsius: number): SimulationState {
  return blocked(sim, entityId, 'la lectura') ?? setEntityState(sim, project, entityId, Math.round(celsius * 10) / 10);
}

/** Fija una lectura numérica genérica (humedad, iluminancia, potencia...). */
export function setSensorValue(sim: SimulationState, project: Project, entityId: string, value: number): SimulationState {
  return blocked(sim, entityId, 'la lectura') ?? setEntityState(sim, project, entityId, value);
}

/** Pulsación de un mando inalámbrico (sensor de acción): "single", "double", "hold"... */
export function pressButton(sim: SimulationState, project: Project, entityId: string, action = 'single'): SimulationState {
  const stop = blocked(sim, entityId, 'la pulsación');
  if (stop) return stop;
  const pressed = setEntityState(sim, project, entityId, action);
  return setEntityState(pressed, project, entityId, 'none');
}

/** Cerradura atascada: solo se fuerza con este evento; lock/unlock la desatascan. */
export function jamLock(sim: SimulationState, project: Project, entityId: string): SimulationState {
  return blocked(sim, entityId, 'el atasco') ?? setEntityState(sim, project, entityId, 'jammed');
}

/** Estado al que vuelve una entidad tras recuperarse (sin transitorios que nadie terminará). */
function recovered(entityId: string, st: EntityState): EntityState {
  const domain = entityId.split('.')[0];
  const restore: EntityState = { ...st, attributes: { ...st.attributes } };
  if (domain === 'cover' && (st.state === 'opening' || st.state === 'closing')) {
    restore.state = Number(st.attributes?.current_position ?? 0) > 0 ? 'open' : 'closed';
  }
  if (domain === 'vacuum' && st.state === 'returning') restore.state = 'docked';
  if (domain === 'binary_sensor' && st.state === 'on' && MOTION_CLASSES.has(String(st.attributes?.device_class))) {
    // movimiento u ocupación: sin el temporizador de autoapagado, vuelve a reposo
    restore.state = 'off';
  }
  return restore;
}

/**
 * Simula que un dispositivo se desconecta (offline = true): sus entidades pasan a 'unavailable'
 * y se cancelan sus temporizadores. Al recuperarse vuelven a su estado anterior.
 */
export function setDeviceOffline(sim: SimulationState, project: Project, deviceId: Id, offline: boolean): SimulationState {
  const device = project.devices.find((d) => d.id === deviceId);
  const def = device ? catalog.find((d) => d.id === device.definitionId) : undefined;
  if (!device || !def) return warn(sim, `Dispositivo desconocido: ${deviceId}`);
  const ids = entitiesForDevice(device, def)
    .map((e) => e.entityId)
    .filter((id) => sim.entities[id] !== undefined);
  const saved = sim.offline?.[deviceId];
  if (offline) {
    if (saved) return sim;
    const snapshot: Record<string, EntityState> = {};
    let result: SimulationState = sim;
    for (const id of ids) {
      const st = sim.entities[id];
      if (st) snapshot[id] = st;
      result = cancelTimer(result, entityTimerKey(id));
    }
    result = { ...result, offline: { ...result.offline, [deviceId]: snapshot } };
    for (const id of ids) result = setEntityState(result, project, id, 'unavailable');
    return result;
  }
  if (!saved) return sim;
  const rest = { ...sim.offline };
  delete rest[deviceId];
  let result: SimulationState = { ...sim, offline: rest };
  for (const [id, st] of Object.entries(saved)) {
    if (result.entities[id]) result = setEntityState(result, project, id, recovered(id, st), { replace: true });
  }
  return result;
}

/** ¿Está el dispositivo simulado como desconectado? */
export function isDeviceOffline(sim: SimulationState, deviceId: Id): boolean {
  return sim.offline?.[deviceId] !== undefined;
}
