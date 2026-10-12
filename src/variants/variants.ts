// Variantes del proyecto (B17): instantáneas con nombre y comparación entre alternativas.
import type { DeviceDefinition, Id, Project, ProjectVariant } from '../types';
import { isCloud } from '../devices/catalog';
import { effectiveIotClass } from '../devices/roles';
import { entitiesForDevice } from '../devices/entities';
import { automationEntityIds } from '../devices/areas';
import { billOfMaterials } from '../export/bom';

export type ProjectSnapshot = Omit<Project, 'variants'>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Instantánea del proyecto sin sus variantes (copia profunda). */
export function snapshotOf(project: Project): ProjectSnapshot {
  const copy: Project = clone(project);
  delete copy.variants;
  return copy;
}

/** Guarda el estado actual del proyecto como variante. Devuelve el proyecto con la variante añadida. */
export function createVariant(project: Project, name: string, id: Id = crypto.randomUUID()): Project {
  const variant: ProjectVariant = { id, name: name.trim() || 'Variante sin nombre', snapshot: snapshotOf(project) };
  return { ...project, variants: [...(project.variants ?? []), variant] };
}

/**
 * Sustituye el contenido del proyecto por el de la variante. Conserva el id, la fecha de
 * creación y la lista de variantes. Lanza Error si la variante no existe.
 */
export function applyVariant(project: Project, variantId: Id): Project {
  const variant = project.variants?.find((v) => v.id === variantId);
  if (!variant) throw new Error(`Variante desconocida: ${variantId}`);
  const snapshot = clone(variant.snapshot);
  const result: Project = { ...snapshot, id: project.id, createdAt: project.createdAt };
  if (project.variants) result.variants = project.variants;
  return result;
}

export function renameVariant(project: Project, variantId: Id, name: string): Project {
  if (!project.variants?.some((v) => v.id === variantId)) return project;
  return { ...project, variants: project.variants.map((v) => (v.id === variantId ? { ...v, name } : v)) };
}

export function deleteVariant(project: Project, variantId: Id): Project {
  if (!project.variants?.some((v) => v.id === variantId)) return project;
  return { ...project, variants: project.variants.filter((v) => v.id !== variantId) };
}

/** Actualiza la instantánea de una variante con el estado actual del proyecto. */
export function updateVariant(project: Project, variantId: Id): Project {
  if (!project.variants?.some((v) => v.id === variantId)) return project;
  const snapshot = snapshotOf(project);
  return { ...project, variants: project.variants.map((v) => (v.id === variantId ? { ...v, snapshot } : v)) };
}

// ---------- Comparación ----------

export interface CloudDependency {
  automationId: Id;
  name: string;
  /** Entidades de dispositivos en la nube que usa la automatización. */
  entityIds: string[];
}

export interface VariantSummary {
  /** Dispositivos (incluida la infraestructura). */
  devices: number;
  /** Dispositivos finales con integración local / en la nube (sin infraestructura salvo hubs). */
  local: number;
  cloud: number;
  /** Coordinadores, hubs, puentes y border routers que necesita la instalación (nombres). */
  hubs: string[];
  /** Automatizaciones que dejarían de funcionar sin Internet. */
  cloudDependencies: CloudDependency[];
  /** Dispositivos alimentados por pilas. */
  batteries: number;
  automations: number;
  /** Coste total según el presupuesto (billOfMaterials); solo si se pasa `costOf` (ver budgetCost). */
  cost?: number;
}

export interface VariantComparison {
  a: VariantSummary;
  b: VariantSummary;
  /** b − a de los valores numéricos. */
  diff: { devices: number; local: number; cloud: number; hubs: number; cloudDependencies: number; batteries: number; automations: number; cost?: number };
}

const HUB_ROLES = new Set(['coordinator', 'hub', 'border_router']);

export function summarizeProject(project: ProjectSnapshot, defs: DeviceDefinition[], costOf?: (p: ProjectSnapshot) => number | undefined): VariantSummary {
  let local = 0;
  let cloud = 0;
  let batteries = 0;
  const hubs: string[] = [];
  const cloudEntities = new Set<string>();
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) continue;
    if (def.power === 'battery') batteries++;
    if (HUB_ROLES.has(def.role)) hubs.push(device.name);
    if (def.role === 'ha_server' || def.role === 'access_point' || def.role === 'coordinator') continue;
    if (isCloud(effectiveIotClass(device, def))) {
      cloud++;
      for (const e of entitiesForDevice(device, def)) cloudEntities.add(e.entityId);
    } else {
      local++;
    }
  }
  const cloudDependencies: CloudDependency[] = [];
  for (const a of project.automations) {
    const ids = [...new Set(automationEntityIds(a).filter((id) => cloudEntities.has(id)))];
    if (ids.length > 0) cloudDependencies.push({ automationId: a.id, name: a.name, entityIds: ids });
  }
  const summary: VariantSummary = { devices: project.devices.length, local, cloud, hubs, cloudDependencies, batteries, automations: project.automations.length };
  const cost = costOf?.(project);
  if (cost !== undefined) summary.cost = cost;
  return summary;
}

/**
 * Proveedor de coste para compareVariants: el total del presupuesto (billOfMaterials, con los
 * precios propios de los ajustes de cada variante).
 */
export function budgetCost(defs: DeviceDefinition[]): (p: ProjectSnapshot) => number {
  return (p) => billOfMaterials(p, defs).total;
}

/** Compara dos variantes (o proyectos). `costOf`: proveedor de coste (budgetCost para el presupuesto). */
export function compareVariants(
  a: ProjectSnapshot,
  b: ProjectSnapshot,
  defs: DeviceDefinition[],
  costOf?: (p: ProjectSnapshot) => number | undefined,
): VariantComparison {
  const sa = summarizeProject(a, defs, costOf);
  const sb = summarizeProject(b, defs, costOf);
  const diff: VariantComparison['diff'] = {
    devices: sb.devices - sa.devices,
    local: sb.local - sa.local,
    cloud: sb.cloud - sa.cloud,
    hubs: sb.hubs.length - sa.hubs.length,
    cloudDependencies: sb.cloudDependencies.length - sa.cloudDependencies.length,
    batteries: sb.batteries - sa.batteries,
    automations: sb.automations - sa.automations,
  };
  if (sa.cost !== undefined && sb.cost !== undefined) diff.cost = sb.cost - sa.cost;
  return { a: sa, b: sb, diff };
}
