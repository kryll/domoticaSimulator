// Renombrado de dispositivos: mantiene coherentes las referencias a entity_id del proyecto.
import type { Action, Automation, Condition, Device, DeviceDefinition, EntityState, Project, Script, Trigger } from '../types';
import { entityIdsForDevice } from './entities';

/**
 * entity_id antiguo -> nuevo al renombrar un dispositivo. Solo incluye los que cambian.
 */
export function entityIdMappingForRename(device: Device, def: DeviceDefinition, newName: string): Record<string, string> {
  const before = entityIdsForDevice(device, def);
  const after = entityIdsForDevice({ ...device, name: newName }, def);
  const mapping: Record<string, string> = {};
  before.forEach((oldId, i) => {
    const newId = after[i];
    if (newId !== undefined && newId !== oldId) mapping[oldId] = newId;
  });
  return mapping;
}

type Mapper = (entityId: string) => string;

function mapTrigger(t: Trigger, map: Mapper): Trigger {
  return t.type === 'state' || t.type === 'numeric_state' ? { ...t, entityId: map(t.entityId) } : t;
}

function mapCondition(c: Condition, map: Mapper): Condition {
  switch (c.type) {
    case 'state':
    case 'numeric_state':
      return { ...c, entityId: map(c.entityId) };
    case 'and':
    case 'or':
      return { ...c, conditions: c.conditions.map((x) => mapCondition(x, map)) };
    case 'time':
    case 'sun':
      return c;
  }
}

function mapAction(a: Action, map: Mapper): Action {
  return a.type === 'service' ? { ...a, entityId: map(a.entityId) } : a;
}

function mapAutomation(a: Automation, map: Mapper): Automation {
  return {
    ...a,
    triggers: a.triggers.map((t) => mapTrigger(t, map)),
    conditions: a.conditions.map((c) => mapCondition(c, map)),
    actions: a.actions.map((x) => mapAction(x, map)),
  };
}

function mapScript(s: Script, map: Mapper): Script {
  return { ...s, sequence: s.sequence.map((a) => mapAction(a, map)) };
}

function mapSceneEntities(entities: Record<string, EntityState>, map: Mapper): Record<string, EntityState> {
  const result: Record<string, EntityState> = {};
  for (const [id, state] of Object.entries(entities)) result[map(id)] = state;
  return result;
}

/**
 * Reescribe los entity_id de triggers, condiciones (anidadas incluidas), acciones de
 * automatizaciones y scripts, y las claves de las escenas. Función pura: no muta el proyecto.
 */
export function renameEntityRefs(project: Project, mapping: Record<string, string>): Project {
  if (Object.keys(mapping).length === 0) return project;
  const map: Mapper = (id) => (Object.prototype.hasOwnProperty.call(mapping, id) ? (mapping[id] ?? id) : id);
  return {
    ...project,
    automations: project.automations.map((a) => mapAutomation(a, map)),
    scripts: project.scripts.map((s) => mapScript(s, map)),
    scenes: project.scenes.map((s) => ({ ...s, entities: mapSceneEntities(s.entities, map) })),
  };
}

/** Todos los entity_id referenciados por automatizaciones, escenas y scripts, con su origen. */
export interface EntityReference {
  entityId: string;
  kind: 'automation' | 'scene' | 'script';
  ownerId: string;
  ownerName: string;
}

function conditionRefs(c: Condition): string[] {
  if (c.type === 'and' || c.type === 'or') return c.conditions.flatMap(conditionRefs);
  return c.type === 'time' || c.type === 'sun' ? [] : [c.entityId];
}

function actionRefs(a: Action): string[] {
  if (a.type !== 'service') return [];
  // notify.* no tiene entidad de destino.
  if (a.service.startsWith('notify.') && a.entityId === '') return [];
  // "script.<slug>" llama al script directamente y no necesita entity_id.
  if (a.service.startsWith('script.') && a.service !== 'script.turn_on') return [a.service];
  return [a.entityId];
}

export function collectEntityRefs(project: Project): EntityReference[] {
  const refs: EntityReference[] = [];
  for (const a of project.automations) {
    const ids = [
      ...a.triggers.flatMap((t) => (t.type === 'state' || t.type === 'numeric_state' ? [t.entityId] : [])),
      ...a.conditions.flatMap(conditionRefs),
      ...a.actions.flatMap(actionRefs),
    ];
    for (const entityId of ids) refs.push({ entityId, kind: 'automation', ownerId: a.id, ownerName: a.name });
  }
  for (const s of project.scenes) {
    for (const entityId of Object.keys(s.entities)) refs.push({ entityId, kind: 'scene', ownerId: s.id, ownerName: s.name });
  }
  for (const s of project.scripts) {
    for (const entityId of s.sequence.flatMap(actionRefs)) refs.push({ entityId, kind: 'script', ownerId: s.id, ownerName: s.name });
  }
  return refs;
}
