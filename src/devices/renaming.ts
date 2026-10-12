// Renombrado de dispositivos: mantiene coherentes las referencias a entity_id del proyecto.
import type { Action, Automation, Device, DeviceDefinition, EntityState, Project, Script } from '../types';
import { entityIdsForDevice } from './entities';
import {
  actionConditions,
  conditionEntityIds,
  flattenActions,
  mapActionEntities,
  mapConditionEntities,
  mapTriggerEntities,
  triggerEntityIds,
  type EntityMapper,
} from '../automations/walk';

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

/**
 * Fase 3 (B19): entity_id antiguo -> nuevo al cambiar «Mostrar como» (switch ↔ light).
 * Úsalo con renameEntityRefs y renameEntities como al renombrar.
 */
export function entityIdMappingForShowAs(device: Device, def: DeviceDefinition, showAs: Device['showAs']): Record<string, string> {
  const before = entityIdsForDevice(device, def);
  const next: Device = { ...device };
  if (showAs === undefined) delete next.showAs;
  else next.showAs = showAs;
  const after = entityIdsForDevice(next, def);
  const mapping: Record<string, string> = {};
  before.forEach((oldId, i) => {
    const newId = after[i];
    if (newId !== undefined && newId !== oldId) mapping[oldId] = newId;
  });
  return mapping;
}

type Mapper = EntityMapper;

const mapTrigger = mapTriggerEntities;
const mapCondition = mapConditionEntities;
const mapAction = mapActionEntities;

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
    ...renameFase3Refs(project, map),
  };
}

/** Fase 3: miembros de los grupos y entidades de las líneas de tiempo. */
function renameFase3Refs(project: Project, map: Mapper): Partial<Project> {
  const result: Partial<Project> = {};
  if (project.groups) result.groups = project.groups.map((g) => ({ ...g, entityIds: g.entityIds.map(map) }));
  if (project.timelines) {
    result.timelines = project.timelines.map((t) => ({
      ...t,
      steps: t.steps.map((step) => (step.entityId === undefined ? step : { ...step, entityId: map(step.entityId) })),
    }));
  }
  return result;
}

/** Todos los entity_id referenciados por automatizaciones, escenas y scripts, con su origen. */
export interface EntityReference {
  entityId: string;
  kind: 'automation' | 'scene' | 'script';
  ownerId: string;
  ownerName: string;
}

const conditionRefs = conditionEntityIds;

function actionRefs(a: Action): string[] {
  return flattenActions([a]).flatMap((x) => {
    const own = [...actionConditions(x).flatMap(conditionEntityIds)];
    if (x.type === 'wait_for_trigger') own.push(...x.triggers.flatMap(triggerEntityIds));
    if (x.type !== 'service') return own;
    // "script.<slug>" llama al script directamente y no necesita entity_id.
    if (x.service.startsWith('script.') && x.service !== 'script.turn_on') return [...own, x.service];
    return [...own, x.entityId];
  });
}

export function collectEntityRefs(project: Project): EntityReference[] {
  const refs: EntityReference[] = [];
  for (const a of project.automations) {
    const ids = [
      ...a.triggers.flatMap(triggerEntityIds),
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
