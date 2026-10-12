// Copias y versiones del proyecto (historial) en un almacén de IndexedDB propio, y resumen de
// diferencias entre dos proyectos. La lógica de diferencias y de poda es pura y sin React.
import { createStore, delMany, get, getMany, keys, setMany, type UseStore } from 'idb-keyval';
import type { Id, Project } from '../types';
import { parseProject } from './projectSchema';

export interface VersionMeta {
  id: Id;
  projectId: Id;
  /** ISO */
  createdAt: string;
  label?: string;
  /** Copia automática (se poda) o guardada a mano (se conserva). */
  auto: boolean;
  /** «12 dispositivos, 5 automatizaciones, 2 escenas, 1 script». */
  summary: string;
}

/** Metadatos guardados: además, la huella del contenido para no repetir copias iguales. */
interface StoredMeta extends VersionMeta {
  hash: string;
}

let store: UseStore | undefined;

/** Almacén propio (base "ha-sim-versions", tabla "versions"), creado bajo demanda. */
function versionsStore(): UseStore {
  store ??= createStore('ha-sim-versions', 'versions');
  return store;
}

const metaPrefix = (projectId: Id): string => `meta:${projectId}:`;
const metaKey = (projectId: Id, id: Id): string => `${metaPrefix(projectId)}${id}`;
const dataKey = (id: Id): string => `data:${id}`;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Resumen breve del contenido de un proyecto. */
export function versionSummary(p: Pick<Project, 'devices' | 'automations' | 'scenes' | 'scripts'>): string {
  return [
    plural(p.devices.length, 'dispositivo', 'dispositivos'),
    plural(p.automations.length, 'automatización', 'automatizaciones'),
    plural(p.scenes.length, 'escena', 'escenas'),
    plural(p.scripts.length, 'script', 'scripts'),
  ].join(', ');
}

/** JSON con las claves ordenadas: igual para objetos iguales aunque el orden de claves cambie. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Huella del contenido (sin fechas ni revisión): FNV-1a de 32 bits en hexadecimal. */
export function contentHash(project: Project): string {
  const content: Partial<Project> = { ...project };
  delete content.updatedAt;
  delete content.revision;
  const text = stableStringify(content);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function stripHash(m: StoredMeta): VersionMeta {
  const meta: Partial<StoredMeta> & VersionMeta = { ...m };
  delete meta.hash;
  return meta;
}

async function storedMetas(projectId: Id): Promise<StoredMeta[]> {
  const prefix = metaPrefix(projectId);
  const all = (await keys(versionsStore())).filter((k): k is string => typeof k === 'string' && k.startsWith(prefix));
  const values = await getMany<StoredMeta | undefined>(all, versionsStore());
  return values.filter((v): v is StoredMeta => v !== undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface SaveVersionOptions {
  label?: string;
  auto: boolean;
  /** Fecha de la copia (por defecto, ahora). */
  now?: Date;
}

/**
 * Guarda una copia del proyecto. Una copia automática igual a la última copia del proyecto no se
 * repite: devuelve la existente.
 */
export async function saveVersion(project: Project, opts: SaveVersionOptions): Promise<VersionMeta> {
  const hash = contentHash(project);
  if (opts.auto) {
    const [latest] = await storedMetas(project.id);
    if (latest && latest.hash === hash) return stripHash(latest);
  }
  const meta: StoredMeta = {
    id: crypto.randomUUID(),
    projectId: project.id,
    createdAt: (opts.now ?? new Date()).toISOString(),
    auto: opts.auto,
    summary: versionSummary(project),
    hash,
  };
  const label = opts.label?.trim();
  if (label) meta.label = label;
  await setMany(
    [
      [metaKey(project.id, meta.id), meta],
      [dataKey(meta.id), project],
    ],
    versionsStore(),
  );
  return stripHash(meta);
}

/** Copias del proyecto, de la más reciente a la más antigua. */
export async function listVersions(projectId: Id): Promise<VersionMeta[]> {
  return (await storedMetas(projectId)).map(stripHash);
}

/** Proyecto de una copia; undefined si no existe. Lanza Error si está dañada. */
export async function loadVersion(versionId: Id): Promise<Project | undefined> {
  const raw: unknown = await get(dataKey(versionId), versionsStore());
  return raw === undefined ? undefined : parseProject(raw);
}

export async function deleteVersion(versionId: Id): Promise<void> {
  const suffix = `:${versionId}`;
  const metas = (await keys(versionsStore())).filter((k) => typeof k === 'string' && k.startsWith('meta:') && k.endsWith(suffix));
  await delMany([...metas, dataKey(versionId)], versionsStore());
}

/** Borra todas las copias de un proyecto (al borrar el proyecto). */
export async function deleteProjectVersions(projectId: Id): Promise<void> {
  const metas = await storedMetas(projectId);
  await delMany(metas.flatMap((m) => [metaKey(projectId, m.id), dataKey(m.id)]), versionsStore());
}

export interface PruneOptions {
  /** Copias automáticas más recientes que se conservan siempre. */
  keepLast: number;
  /** Además, la última copia automática de cada uno de estos últimos días con copias. */
  keepDaily: number;
}

/**
 * Copias automáticas que sobran (función pura): se conservan las `keepLast` más recientes y la
 * última de cada uno de los `keepDaily` días más recientes con copias. Las manuales no se tocan.
 */
export function versionsToPrune(versions: readonly VersionMeta[], opts: PruneOptions): Id[] {
  const autos = versions.filter((v) => v.auto).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keep = new Set(autos.slice(0, Math.max(0, opts.keepLast)).map((v) => v.id));
  const days = new Set<string>();
  for (const v of autos) {
    const day = v.createdAt.slice(0, 10);
    if (days.has(day)) continue;
    if (days.size >= Math.max(0, opts.keepDaily)) break;
    days.add(day);
    keep.add(v.id);
  }
  return autos.filter((v) => !keep.has(v.id)).map((v) => v.id);
}

/** Poda las copias automáticas del proyecto. Devuelve los ids borrados. */
export async function pruneAutoVersions(projectId: Id, opts: PruneOptions = { keepLast: 20, keepDaily: 7 }): Promise<Id[]> {
  const ids = versionsToPrune(await listVersions(projectId), opts);
  if (ids.length > 0) await delMany(ids.flatMap((id) => [metaKey(projectId, id), dataKey(id)]), versionsStore());
  return ids;
}
