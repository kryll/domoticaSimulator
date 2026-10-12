// Acciones de interfaz sobre personas: CRUD en el proyecto y movimiento en la simulación.
import type { Id, Person, Zone, ZoneKind } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { newId } from '../ui/ids';
import { movePerson } from '../simulation/people';
import { renameEntityRefs, renamePersonMapping } from '../devices/renaming';
import { updateWithRename } from '../store/entityRename';

/** Colores por defecto de las personas nuevas. */
export const PERSON_COLORS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308'];

export function addPerson(name: string): Person {
  const people = useProjectStore.getState().project.people ?? [];
  const person: Person = { id: newId('person'), name, color: PERSON_COLORS[people.length % PERSON_COLORS.length] };
  useProjectStore.getState().update((p) => ({ ...p, people: [...(p.people ?? []), person] }));
  return person;
}

/**
 * Cambia una persona. Si cambia el nombre (y con él person.<slug>), las referencias del proyecto y
 * la simulación pasan al nuevo entity_id en un solo paso de deshacer.
 */
export function updatePerson(id: Id, patch: Partial<Omit<Person, 'id'>>): void {
  const project = useProjectStore.getState().project;
  const mapping = patch.name !== undefined ? renamePersonMapping(project, id, patch.name) : {};
  updateWithRename(mapping, (p) => {
    const next = { ...p, people: (p.people ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    return Object.keys(mapping).length > 0 ? renameEntityRefs(next, mapping) : next;
  });
}

export function removePerson(id: Id): void {
  useProjectStore.getState().update((p) => ({ ...p, people: (p.people ?? []).filter((x) => x.id !== id) }));
}

export function addZone(name: string, kind: ZoneKind = 'other'): Zone {
  const zone: Zone = { id: newId('zone'), name, kind };
  useProjectStore.getState().update((p) => ({ ...p, zones: [...(p.zones ?? []), zone] }));
  return zone;
}

export function removeZone(id: Id): void {
  useProjectStore.getState().update((p) => ({ ...p, zones: (p.zones ?? []).filter((z) => z.id !== id) }));
}

/** Mueve a una persona a una zona ('' = fuera de todas) en la simulación. */
export function movePersonTo(personId: Id, zoneId: Id): void {
  const project = useProjectStore.getState().project;
  useSimulationStore.setState((s) => ({ sim: movePerson(s.sim, project, personId, zoneId) }));
}
