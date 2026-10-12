// «Apagar todo en esta planta» (solo interfaz): qué entidades se apagan y con qué servicio.
import type { EntityState, Id, Project } from '../../types';
import { projectEntities } from '../analysis';
import { useProjectStore } from '../../store/projectStore';
import { useSimulationStore } from '../../store/simulationStore';

const OFF_SERVICES: Record<string, string> = {
  light: 'light.turn_off',
  switch: 'switch.turn_off',
  fan: 'fan.turn_off',
  media_player: 'media_player.turn_off',
};

const ALREADY_OFF = new Set(['off', 'standby', 'unavailable']);

/** Llamadas para apagar luces, enchufes, ventiladores y reproductores encendidos de la planta. */
export function floorOffCalls(project: Project, floorId: Id, entities: Record<string, EntityState>): Array<{ entityId: string; service: string }> {
  const out: Array<{ entityId: string; service: string }> = [];
  for (const ref of projectEntities(project)) {
    if (ref.device.floorId !== floorId) continue;
    const domain = ref.entityId.slice(0, ref.entityId.indexOf('.'));
    const service = OFF_SERVICES[domain];
    if (!service) continue;
    const st = entities[ref.entityId]?.state;
    if (st === undefined || st === false || ALREADY_OFF.has(String(st))) continue;
    out.push({ entityId: ref.entityId, service });
  }
  return out;
}

/** Apaga luces, enchufes, ventiladores y reproductores de la planta. Devuelve cuántos. */
export function turnOffFloor(floorId: string): number {
  const project = useProjectStore.getState().project;
  const sim = useSimulationStore.getState();
  const calls = floorOffCalls(project, floorId, sim.sim.entities);
  for (const c of calls) useSimulationStore.getState().callService(c.entityId, c.service);
  return calls.length;
}

