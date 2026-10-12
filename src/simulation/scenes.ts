// Captura de escenas: solo el estado y los atributos que tienen sentido restaurar (C7).
import type { EntityState, EntityStateValue, SimulationState } from '../types';
import { entityDomain } from '../devices/entities';

/** Atributos que se guardan en una escena, por dominio. */
export const SCENE_ATTRIBUTES: Record<string, readonly string[]> = {
  light: ['brightness', 'color_mode', 'color_temp_kelvin', 'rgb_color'],
  cover: ['current_position'],
  climate: ['temperature', 'preset_mode'],
  media_player: ['volume_level', 'is_volume_muted', 'source'],
  fan: ['percentage'],
};

/** Estado en reposo equivalente a un estado transitorio (persiana en movimiento, etc.). */
function settled(domain: string, st: EntityState): EntityStateValue {
  if (domain === 'cover' && (st.state === 'opening' || st.state === 'closing')) {
    return Number(st.attributes?.current_position ?? 0) > 0 ? 'open' : 'closed';
  }
  if (domain === 'vacuum' && st.state === 'returning') return 'docked';
  return st.state;
}

/** Estado de escena de una entidad: estado + atributos relevantes del dominio. */
export function sceneEntityState(entityId: string, st: EntityState): EntityState {
  const domain = entityDomain(entityId);
  const state = settled(domain, st);
  const keys = SCENE_ATTRIBUTES[domain] ?? [];
  const attributes: Record<string, EntityStateValue> = {};
  const lightOff = domain === 'light' && state !== 'on';
  for (const k of keys) {
    const v = st.attributes?.[k];
    if (v === undefined || lightOff) continue;
    if (domain === 'light' && k === 'color_temp_kelvin' && st.attributes?.color_mode !== 'color_temp') continue;
    if (domain === 'light' && k === 'rgb_color' && st.attributes?.color_mode !== 'rgb') continue;
    attributes[k] = v;
  }
  return Object.keys(attributes).length > 0 ? { state, attributes } : { state };
}

/** Captura el estado actual de las entidades indicadas para guardarlo en una escena. */
export function captureSceneEntities(sim: SimulationState, entityIds: readonly string[]): Record<string, EntityState> {
  const result: Record<string, EntityState> = {};
  for (const id of capturableEntities(sim, entityIds).capturable) {
    const st = sim.entities[id];
    if (st) result[id] = sceneEntityState(id, st);
  }
  return result;
}

export interface CapturableEntities {
  /** Se pueden guardar en la escena. */
  capturable: string[];
  /** No disponibles (dispositivo desconectado): se omiten. */
  unavailable: string[];
  /** No existen en la simulación. */
  missing: string[];
}

/** Clasifica las entidades antes de capturar una escena, para que la interfaz avise. */
export function capturableEntities(sim: SimulationState, entityIds: readonly string[]): CapturableEntities {
  const result: CapturableEntities = { capturable: [], unavailable: [], missing: [] };
  for (const id of entityIds) {
    const st = sim.entities[id];
    if (!st) result.missing.push(id);
    else if (st.state === 'unavailable') result.unavailable.push(id);
    else result.capturable.push(id);
  }
  return result;
}
