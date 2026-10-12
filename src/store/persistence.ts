// Persistencia de proyectos en IndexedDB (idb-keyval) e importación/exportación JSON.
import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';
import { defaultSettings, type Project } from '../types';
import { parseProject } from './projectSchema';

export { createDemoProject } from './demoProject';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

let store: UseStore | undefined;

/** Almacén propio (base "ha-simulator", tabla "projects"), creado bajo demanda. */
export function projectsStore(): UseStore {
  store ??= createStore('ha-simulator', 'projects');
  return store;
}

export function createEmptyProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    version: 1,
    createdAt: now,
    updatedAt: now,
    floors: [{ id: crypto.randomUUID(), name: 'Planta baja', level: 0, pixelsPerMeter: 50 }],
    rooms: [],
    devices: [],
    connections: [],
    automations: [],
    scenes: [],
    scripts: [],
    settings: defaultSettings(),
  };
}

export async function saveProject(p: Project): Promise<void> {
  await set(p.id, p, projectsStore());
}

/** Carga un proyecto; undefined si no existe. Lanza Error si lo guardado está corrupto. */
export async function loadProject(id: string): Promise<Project | undefined> {
  const raw: unknown = await get(id, projectsStore());
  return raw === undefined ? undefined : parseProject(raw);
}

/** Proyectos guardados, del más reciente al más antiguo. Ignora entradas corruptas. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await entries<IDBValidKey, unknown>(projectsStore());
  const summaries: ProjectSummary[] = [];
  for (const [, value] of all) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    if (typeof v.id === 'string' && typeof v.name === 'string' && typeof v.updatedAt === 'string') {
      summaries.push({ id: v.id, name: v.name, updatedAt: v.updatedAt });
    }
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(id: string): Promise<void> {
  await del(id, projectsStore());
}

export function exportProjectJson(p: Project): string {
  return JSON.stringify(p, null, 2);
}

/** Importa un proyecto desde JSON, validando su estructura. Errores en español. */
export function importProjectJson(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido');
  }
  return parseProject(raw);
}
