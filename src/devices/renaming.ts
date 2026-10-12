// Renombrado de dispositivos: mantiene coherentes las referencias a entity_id del proyecto.
import type { Action, Automation, Device, DeviceDefinition, EntityState, Id, Project, Script } from '../types';
import { entityIdsForDevice } from './entities';
import {
  actionConditions,
  conditionEntityIds,
  flattenActions,
  mapActionEntities,
  mapConditionEntities,
  mapTriggerEntities,
  remapServiceDomain,
  serviceEntityIds,
  triggerEntityIds,
  type EntityMapper,
} from '../automations/walk';
import { entityDomain } from './entities';
import { groupEntityId, personEntityId } from '../simulation/logic';
import { allDefinitions } from './catalog';

/** Tanda 3: entity_id antiguo -> nuevo al renombrar un helper (úsalo con renameEntityRefs y renameEntities). */
export { renameHelperMapping } from '../simulation/helpers';

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

/**
 * Fase 3 (B19): cambia «Mostrar como» de un dispositivo y actualiza todas las referencias:
 * entity_id y dominio de los servicios en automatizaciones y scripts (anidadas incluidas),
 * escenas, grupos y líneas de tiempo. Función pura.
 */
export function applyShowAs(project: Project, deviceId: Id, showAs: Device['showAs'], defs: DeviceDefinition[]): Project {
  defs = allDefinitions(project, defs);
  const device = project.devices.find((d) => d.id === deviceId);
  const def = device ? defs.find((d) => d.id === device.definitionId) : undefined;
  if (!device || !def || device.showAs === showAs) return project;
  const next: Device = { ...device };
  if (showAs === undefined) delete next.showAs;
  else next.showAs = showAs;
  const mapping = entityIdMappingForShowAs(device, def, showAs);
  const updated: Project = { ...project, devices: project.devices.map((d) => (d.id === deviceId ? next : d)) };
  return renameEntityRefs(updated, mapping);
}

/** entity_id antiguo -> nuevo al renombrar un grupo (vacío si no cambia). */
export function renameGroupMapping(project: Pick<Project, 'groups'>, groupId: Id, newName: string): Record<string, string> {
  const g = project.groups?.find((x) => x.id === groupId);
  if (!g) return {};
  const from = groupEntityId(g);
  const to = groupEntityId({ ...g, name: newName });
  return from === to ? {} : { [from]: to };
}

/** entity_id antiguo -> nuevo al renombrar una persona (vacío si no cambia). */
export function renamePersonMapping(project: Pick<Project, 'people'>, personId: Id, newName: string): Record<string, string> {
  const p = project.people?.find((x) => x.id === personId);
  if (!p) return {};
  const from = personEntityId(p);
  const to = personEntityId({ ...p, name: newName });
  return from === to ? {} : { [from]: to };
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

/** Atributos de escena que conserva cada dominio al cambiar «Mostrar como» (un switch no tiene brillo). */
function sceneStateForDomain(state: EntityState, from: string, to: string): EntityState {
  if (from === to || to !== 'switch' || !state.attributes) return state;
  const copy: EntityState = { ...state };
  delete copy.attributes;
  return copy;
}

function mapSceneEntities(entities: Record<string, EntityState>, map: Mapper): Record<string, EntityState> {
  const result: Record<string, EntityState> = {};
  for (const [id, state] of Object.entries(entities)) {
    const to = map(id);
    result[to] = sceneStateForDomain(state, entityDomain(id), entityDomain(to));
  }
  return result;
}

/**
 * Reescribe los entity_id de triggers, condiciones (anidadas incluidas), acciones de
 * automatizaciones y scripts (también las anidadas de choose/if/repeat/wait_for_trigger, con walk.ts), y las claves de las escenas. Función pura: no muta el proyecto.
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
      steps: t.steps.map((step) => {
        if (step.entityId === undefined) return step;
        const entityId = map(step.entityId);
        if (step.kind === 'event' && step.service !== undefined) return { ...step, entityId, service: remapServiceDomain(step.service, step.entityId, entityId) };
        return { ...step, entityId };
      }),
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

/** entity_id de una acción y de sus acciones anidadas (choose/if/repeat/wait_for_trigger, vía walk.ts). */
function actionRefs(a: Action): string[] {
  return flattenActions([a]).flatMap((x) => {
    const own = [...actionConditions(x).flatMap(conditionEntityIds)];
    if (x.type === 'wait_for_trigger') own.push(...x.triggers.flatMap(triggerEntityIds));
    if (x.type !== 'service') return own;
    // notify.* no tiene entidad de destino.
    if (x.service.startsWith('notify.') && x.entityId === '') return own;
    // "script.<slug>" llama al script directamente y no necesita entity_id.
    if (x.service.startsWith('script.') && x.service !== 'script.turn_on') return [...own, x.service];
    // Destino principal y destinos adicionales (targets.entityIds). Una acción solo con áreas no
    // tiene entity_id: no cuenta como referencia vacía.
    if (x.entityId === '' && (x.targets?.entityIds?.length || x.targets?.areaIds?.length)) return [...own, ...serviceEntityIds(x)];
    return [...own, x.entityId, ...serviceEntityIds(x).slice(x.entityId === '' ? 0 : 1)];
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
