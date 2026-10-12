// Atajos para simular eventos físicos desde la interfaz o los tests.
import type { DeviceDefinition, EntityState, Id, Project, SimulationState } from '../types';
import { allDefinitions } from '../devices/catalog';
import { entityCapabilities, findEntityOwner } from '../devices/capabilities';
import { entitiesForDevice } from '../devices/entities';
import { appendLog, cancelTimer, entityTimerKey, fireEvent, markRecordedEvent, scheduleTimer, setEntityState } from './engine';
import { SECOND_MS } from './clock';
import { isDownByFailure, offlineBlockReason, reconcileAvailability } from './availability';

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
  const on = markRecordedEvent(sim, setEntityState(sim, project, entityId, 'on'), { kind: 'physical', event: 'motion', entityId });
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
  const released = markRecordedEvent(sim, setEntityState(pressed, project, entityId, 'none'), { kind: 'physical', event: 'button', entityId, value: action });
  // Tanda 3: el mando también lanza su evento en el bus (zha_event o hue_event), como en HA.
  const owner = findEntityOwner(project, entityId);
  if (owner?.device.integration === 'zha') return fireEvent(released, project, 'zha_event', { device_id: owner.device.id, command: action });
  if (owner?.device.integration === 'hue') return fireEvent(released, project, 'hue_event', { id: owner.device.id, type: action });
  return released;
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
 * Simula que un dispositivo se desconecta a mano (offline = true): sus entidades pasan a
 * 'unavailable' y se cancelan sus temporizadores. Al reconectarlo vuelven a su estado anterior,
 * salvo que siga caído por un fallo simulado, por la red o por tener la batería agotada: entonces
 * sigue no disponible (queda a cargo de los fallos) y se avisa del motivo en el registro.
 */
export function setDeviceOffline(
  sim: SimulationState,
  project: Project,
  deviceId: Id,
  offline: boolean,
  defs: DeviceDefinition[] = allDefinitions(project),
): SimulationState {
  defs = allDefinitions(project, defs);
  const byFailure = isDownByFailure(sim, deviceId);
  if (offline) {
    // Ya caído por un fallo: pasa a estar desconectado a mano (conserva el estado guardado).
    if (byFailure) return { ...sim, failureOffline: (sim.failureOffline ?? []).filter((id) => id !== deviceId) };
    return setDeviceOfflineRaw(sim, project, deviceId, true, defs);
  }
  const restored = byFailure ? sim : setDeviceOfflineRaw(sim, project, deviceId, false, defs);
  const result = reconcileAvailability(restored, project, defs);
  if (!isDeviceOffline(result, deviceId)) return result;
  const reason = offlineBlockReason(result, project, defs, deviceId);
  const name = project.devices.find((d) => d.id === deviceId)?.name ?? deviceId;
  return warn(result, `«${name}» sigue sin estar disponible${reason ? `: ${reason}` : ''}`);
}

/**
 * Mecanismo base (uso interno de availability.ts): pasa las entidades del dispositivo a
 * 'unavailable' guardando su estado, o lo restaura, sin comprobar fallos ni baterías.
 */
export function setDeviceOfflineRaw(
  sim: SimulationState,
  project: Project,
  deviceId: Id,
  offline: boolean,
  defs: DeviceDefinition[] = allDefinitions(project),
): SimulationState {
  defs = allDefinitions(project, defs);
  const device = project.devices.find((d) => d.id === deviceId);
  const def = device ? defs.find((d) => d.id === device.definitionId) : undefined;
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
    for (const id of ids) result = setEntityState(result, project, id, 'unavailable', { record: false });
    return result;
  }
  if (!saved) return sim;
  const rest = { ...sim.offline };
  delete rest[deviceId];
  let result: SimulationState = { ...sim, offline: rest };
  for (const [id, st] of Object.entries(saved)) {
    if (result.entities[id]) result = setEntityState(result, project, id, recovered(id, st), { replace: true, record: false });
  }
  return result;
}

/** ¿Está el dispositivo simulado como desconectado? */
export function isDeviceOffline(sim: SimulationState, deviceId: Id): boolean {
  return sim.offline?.[deviceId] !== undefined;
}
