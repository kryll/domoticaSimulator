// Diferencias entre versiones del proyecto y del estado para el protocolo del lab. Funciones puras.
import type { DeviceDefinition, EntityState, Project } from '../types';

/** Cambios de entidades entre dos estados (por referencia, como los produce el motor inmutable). */
export function diffEntities(
  prev: Readonly<Record<string, EntityState>>,
  next: Readonly<Record<string, EntityState>>,
): { changed: Record<string, EntityState>; removed: string[] } {
  const changed: Record<string, EntityState> = {};
  for (const [id, st] of Object.entries(next)) if (prev[id] !== st) changed[id] = st;
  const removed = Object.keys(prev).filter((id) => !(id in next));
  return { changed, removed };
}

/**
 * Parche de primer nivel entre dos versiones del proyecto: las claves cuyo valor ha cambiado
 * (por referencia). null si es otro proyecto (hay que mandar el completo). Las claves borradas
 * se mandan como undefined… que JSON omite, así que se marcan con null en `removedKeys`.
 */
export function projectPatch(prev: Project, next: Project): { changes: Partial<Project>; removedKeys: string[] } | null {
  if (prev.id !== next.id) return null;
  const changes: Record<string, unknown> = {};
  const a = prev as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  for (const key of Object.keys(b)) if (a[key] !== b[key]) changes[key] = b[key];
  const removedKeys = Object.keys(a).filter((k) => !(k in b));
  return { changes: changes as Partial<Project>, removedKeys };
}

/** Definiciones del catálogo que usa el proyecto (lo que necesita el orquestador). */
export function definitionsFor(project: Pick<Project, 'devices'>, lookup: (id: string) => DeviceDefinition | undefined): DeviceDefinition[] {
  const out = new Map<string, DeviceDefinition>();
  for (const d of project.devices) {
    const def = lookup(d.definitionId);
    if (def) out.set(def.id, def);
  }
  return [...out.values()];
}

/** El proyecto sin lo que no necesita el lab (imágenes del plano, variantes). */
export function projectForLab(project: Project): Project {
  const copy: Project = { ...project, floors: project.floors.map((f) => ({ ...f })) };
  delete copy.variants;
  for (const f of copy.floors) delete f.backgroundImage;
  return copy;
}
