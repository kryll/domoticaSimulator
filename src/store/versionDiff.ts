// Diferencias entre dos proyectos (para el historial de versiones). Aparte de versions.ts para
// que la comparación de variantes (y la lista de materiales que usa) no vaya en la carga inicial.
import type { DeviceDefinition, Id, Project } from '../types';
import { stableStringify } from './versions';
import { compareVariants, type VariantComparison } from '../variants/variants';

// ---------- Diferencias ----------

export interface NamedRef {
  id: Id;
  name: string;
}

export interface CollectionDiff {
  added: NamedRef[];
  removed: NamedRef[];
  modified: NamedRef[];
}

export interface ProjectDiff {
  devices: CollectionDiff;
  automations: CollectionDiff;
  scenes: CollectionDiff;
  scripts: CollectionDiff;
  rooms: CollectionDiff;
  /** true si no hay ningún cambio en esas colecciones. */
  identical: boolean;
  /** Líneas legibles: «Dispositivos: 2 añadidos (Luz cocina, Sensor puerta), 1 quitado (…)». */
  summary: string[];
  /** Comparación de resumen (local/nube, hubs, coste...) si se pasa el catálogo. */
  comparison?: VariantComparison;
}

function diffCollection<T extends { id: Id; name: string }>(a: readonly T[], b: readonly T[]): CollectionDiff {
  const before = new Map(a.map((x) => [x.id, x]));
  const after = new Map(b.map((x) => [x.id, x]));
  const ref = (x: T): NamedRef => ({ id: x.id, name: x.name });
  return {
    added: b.filter((x) => !before.has(x.id)).map(ref),
    removed: a.filter((x) => !after.has(x.id)).map(ref),
    modified: b.filter((x) => {
      const old = before.get(x.id);
      return old !== undefined && stableStringify(old) !== stableStringify(x);
    }).map(ref),
  };
}

const LABELS: Record<'devices' | 'automations' | 'scenes' | 'scripts' | 'rooms', [string, string, 'm' | 'f']> = {
  devices: ['Dispositivos', 'dispositivo', 'm'],
  automations: ['Automatizaciones', 'automatización', 'f'],
  scenes: ['Escenas', 'escena', 'f'],
  scripts: ['Scripts', 'script', 'm'],
  rooms: ['Salas', 'sala', 'f'],
};

function describeCollection(key: keyof typeof LABELS, d: CollectionDiff): string | undefined {
  const [title, , gender] = LABELS[key];
  const word = (base: 'añadid' | 'quitad' | 'modificad', n: number): string => `${base}${gender === 'm' ? 'o' : 'a'}${n === 1 ? '' : 's'}`;
  const part = (refs: NamedRef[], base: 'añadid' | 'quitad' | 'modificad'): string | undefined =>
    refs.length === 0 ? undefined : `${refs.length} ${word(base, refs.length)} (${refs.map((r) => r.name).join(', ')})`;
  const parts = [part(d.added, 'añadid'), part(d.removed, 'quitad'), part(d.modified, 'modificad')].filter((x): x is string => x !== undefined);
  return parts.length === 0 ? undefined : `${title}: ${parts.join(', ')}`;
}

/** Diferencias de `a` (antes) a `b` (después): qué se añadió, quitó o modificó, con nombres. */
export function diffProjects(a: Project, b: Project, defs?: DeviceDefinition[]): ProjectDiff {
  const result: ProjectDiff = {
    devices: diffCollection(a.devices, b.devices),
    automations: diffCollection(a.automations, b.automations),
    scenes: diffCollection(a.scenes, b.scenes),
    scripts: diffCollection(a.scripts, b.scripts),
    rooms: diffCollection(a.rooms, b.rooms),
    identical: false,
    summary: [],
  };
  const keysList = ['devices', 'automations', 'scenes', 'scripts', 'rooms'] as const;
  result.summary = keysList.map((k) => describeCollection(k, result[k])).filter((x): x is string => x !== undefined);
  result.identical = result.summary.length === 0;
  if (defs) result.comparison = compareVariants(a, b, defs);
  return result;
}
