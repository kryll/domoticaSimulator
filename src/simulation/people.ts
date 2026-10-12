// Personas y zonas en la simulación (B9).
import type { Id, Project, SimulationState } from '../types';
import { appendLog, markRecordedEvent, setEntityState } from './engine';
import { findZone, NOT_HOME, personEntityId, projectZones, zoneCounts, zoneEntityId, zoneStateName } from './logic';

export {
  findZone,
  HOME_ZONE_ID,
  NOT_HOME,
  peopleEntities,
  personEntityId,
  personZoneId,
  projectZones,
  zoneEntityId,
  zoneStateName,
} from './logic';

/**
 * Mueve una persona a una zona (o fuera de todas con zoneId null / '' / 'not_home').
 * Cambia person.<slug> (home, nombre de la zona o not_home), dispara los disparadores de zona
 * y actualiza el número de personas de cada zone.<slug>.
 */
export function movePerson(sim: SimulationState, project: Project, personId: Id, zoneId: Id | null): SimulationState {
  const person = project.people?.find((p) => p.id === personId);
  if (!person) return appendLog(sim, 'warning', `Persona desconocida: ${personId}`);
  const away = zoneId === null || zoneId === '' || zoneId === NOT_HOME;
  const zone = away ? undefined : findZone(project, zoneId);
  if (!away && !zone) return appendLog(sim, 'warning', `Zona desconocida: ${String(zoneId)}`);
  const entityId = personEntityId(person);
  if (!sim.entities[entityId]) return appendLog(sim, 'warning', `Entidad desconocida: ${entityId}`, { entityId });
  const state = zone ? zoneStateName(zone) : NOT_HOME;
  const next = { state, attributes: { ...sim.entities[entityId].attributes, zone_id: zone?.id ?? '' } };
  // Primero los recuentos de las zonas, para que las automatizaciones que dispara la persona
  // (p. ej. «si no queda nadie en casa») ya vean el número actualizado, como en HA.
  const counts = zoneCounts(project, { ...sim.entities, [entityId]: next });
  let result = sim;
  for (const z of projectZones(project)) {
    const id = zoneEntityId(z);
    const count = counts[z.id] ?? 0;
    if (result.entities[id] && result.entities[id].state !== count) result = setEntityState(result, project, id, count, { quiet: true });
  }
  result = setEntityState(result, project, entityId, next);
  return markRecordedEvent(sim, result, { kind: 'person', personId, zoneId: zone?.id ?? null });
}
