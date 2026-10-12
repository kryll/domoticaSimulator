// Personas y zonas en la simulación (B9).
import type { EntityState, EntityStateValue, Id, Project, SimulationState } from '../types';
import { appendLog, markRecordedEvent, setEntityState } from './engine';
import { entityDomain } from '../devices/entities';
import { findZone, NOT_HOME, peopleEntities, personEntityId, projectZones, zoneCounts, zoneEntityId, zoneStateName } from './logic';

export {
  findZone,
  HOME_ZONE_ID,
  NOT_HOME,
  peopleEntities,
  personEntityId,
  personZoneId,
  projectZones,
  zoneEntityId,
  zoneCounts,
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

/**
 * Pone al día las entidades person.* y zone.* con el proyecto (personas o zonas añadidas,
 * renombradas o borradas) sin disparar automatizaciones: conserva el estado de cada persona por
 * su person_id aunque cambie su slug, manda fuera de casa a quien estaba en una zona borrada y
 * recalcula siempre el número de personas de cada zona. Función pura.
 */
export function syncPeopleEntities(sim: SimulationState, project: Project): SimulationState {
  const fresh = peopleEntities(project);
  const entities: Record<string, EntityState> = {};
  for (const [id, st] of Object.entries(sim.entities)) {
    const domain = entityDomain(id);
    if (domain !== 'person' && domain !== 'zone') entities[id] = st;
  }
  const previousPerson = (personId: Id): EntityState | undefined =>
    Object.entries(sim.entities).find(([id, e]) => entityDomain(id) === 'person' && e.attributes?.person_id === personId)?.[1];
  for (const p of project.people ?? []) {
    const id = personEntityId(p);
    const base = fresh[id];
    if (!base) continue;
    const prev = previousPerson(p.id);
    if (!prev) {
      entities[id] = base;
      continue;
    }
    const zoneId = String(prev.attributes?.zone_id ?? '');
    const zone = zoneId === '' ? undefined : findZone(project, zoneId);
    const state: EntityStateValue = zone ? zoneStateName(zone) : NOT_HOME;
    const st: EntityState = { state, attributes: { ...base.attributes, zone_id: zone?.id ?? '' } };
    if (prev.lastChanged !== undefined) st.lastChanged = prev.lastChanged;
    entities[id] = st;
  }
  const counts = zoneCounts(project, entities);
  for (const z of projectZones(project)) {
    const id = zoneEntityId(z);
    const base = fresh[id];
    if (!base) continue;
    const prev = Object.entries(sim.entities).find(([eid, e]) => entityDomain(eid) === 'zone' && e.attributes?.zone_id === z.id)?.[1];
    const count = counts[z.id] ?? 0;
    const st: EntityState = { state: count, attributes: base.attributes ?? {} };
    if (prev?.lastChanged !== undefined && prev.state === count) st.lastChanged = prev.lastChanged;
    else if (prev && prev.state !== count) st.lastChanged = sim.now;
    entities[id] = st;
  }
  return { ...sim, entities };
}
