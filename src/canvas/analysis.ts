import type { Device, DeviceDefinition, EntityDefinition, Id, Project, ValidationIssue } from '../types';
import { allDefinitions, catalog, getDefinition } from '../devices/catalog';
import { entitiesForDevice } from '../devices/entities';
import { analyzeMesh } from '../network/mesh';
import { validateProject } from '../network/validator';

export interface ProjectAnalysis {
  issues: ValidationIssue[];
  /** deviceId -> incidencias que lo mencionan */
  issuesByDevice: Map<Id, ValidationIssue[]>;
  unreachable: Set<Id>;
}

const cache = new WeakMap<Project, ProjectAnalysis>();

/** De dónde salen las definiciones personalizadas (el proyecto abierto; lo fija projectStore). */
let customSource: () => Pick<Project, 'customDefinitions'> = () => ({});

export function setCustomDefinitionsSource(source: () => Pick<Project, 'customDefinitions'>): void {
  customSource = source;
}

/** Catálogo + dispositivos personalizados del proyecto abierto. */
export function knownDefinitions(): DeviceDefinition[] {
  return allDefinitions(customSource());
}

/** Validación y análisis de malla memorizados por referencia de proyecto. */
export function analyzeProject(project: Project): ProjectAnalysis {
  const cached = cache.get(project);
  if (cached) return cached;
  let issues: ValidationIssue[] = [];
  let unreachable = new Set<Id>();
  try {
    issues = validateProject(project, allDefinitions(project, catalog));
  } catch (err) {
    console.error('Error en el validador', err);
  }
  try {
    unreachable = new Set(analyzeMesh(project, allDefinitions(project, catalog)).unreachable);
  } catch (err) {
    console.error('Error en el análisis de malla', err);
  }
  const issuesByDevice = new Map<Id, ValidationIssue[]>();
  for (const issue of issues) {
    for (const id of issue.deviceIds) {
      const list = issuesByDevice.get(id) ?? [];
      list.push(issue);
      issuesByDevice.set(id, list);
    }
  }
  const result = { issues, issuesByDevice, unreachable };
  cache.set(project, result);
  return result;
}

export function definitionOf(device: Device): DeviceDefinition | undefined {
  return getDefinition(device.definitionId, knownDefinitions());
}

export interface EntityRef {
  entityId: string;
  device: Device;
  definition: EntityDefinition;
  friendlyName: string;
}

/** Entidades de un dispositivo emparejadas con su definición. */
export function entitiesOfDevice(device: Device): EntityRef[] {
  const def = definitionOf(device);
  if (!def) return [];
  return entitiesForDevice(device, def).map((e) => ({
    entityId: e.entityId,
    device,
    definition: e.definition,
    friendlyName: e.friendlyName,
  }));
}

const entityCache = new WeakMap<Project, EntityRef[]>();

/** Todas las entidades del proyecto. */
export function projectEntities(project: Project): EntityRef[] {
  const cached = entityCache.get(project);
  if (cached) return cached;
  const list = project.devices.flatMap(entitiesOfDevice);
  entityCache.set(project, list);
  return list;
}
