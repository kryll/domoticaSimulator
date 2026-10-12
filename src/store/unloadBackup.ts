// Respaldo síncrono en localStorage al ocultar o cerrar la pestaña. IndexedDB es asíncrono: lo
// editado en los últimos instantes (el guardado automático espera ~800 ms) podría perderse al
// recargar. Al arrancar, si el respaldo es más reciente que lo guardado, se aplica (con aviso).
// Lógica pura salvo el acceso al almacenamiento, siempre con try/catch.
import type { Project } from '../types';
import { parseProject } from './projectSchema';
import { contentHash } from './versions';

export const BACKUP_PREFIX = 'ha-simulator:unsaved:';
/** Tamaño máximo del respaldo (caracteres): localStorage suele admitir ~5 MB por origen. */
export const MAX_BACKUP_CHARS = 2_000_000;

export interface UnsavedBackup {
  projectId: string;
  /** Revisión guardada en IndexedDB sobre la que se hicieron los cambios. */
  revision: number;
  /** Momento del respaldo (ms desde epoch). */
  savedAt: number;
  json: string;
}

/** Almacenamiento mínimo (localStorage o uno falso en los tests). */
export type BackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function backupKey(projectId: string): string {
  return `${BACKUP_PREFIX}${projectId}`;
}

/** Texto del respaldo, o undefined si pasa del límite de tamaño. */
export function serializeBackup(project: Project, revision: number, now: number, maxChars = MAX_BACKUP_CHARS): string | undefined {
  const json = JSON.stringify(project);
  const text = JSON.stringify({ projectId: project.id, revision, savedAt: now, json } satisfies UnsavedBackup);
  return text.length > maxChars ? undefined : text;
}

export function parseBackup(text: string | null): UnsavedBackup | undefined {
  if (text === null) return undefined;
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null) return undefined;
    const o = v as Record<string, unknown>;
    if (typeof o.projectId !== 'string' || typeof o.json !== 'string') return undefined;
    if (typeof o.revision !== 'number' || typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return undefined;
    return { projectId: o.projectId, revision: o.revision, savedAt: o.savedAt, json: o.json };
  } catch {
    return undefined;
  }
}

/** Escribe el respaldo de forma síncrona. Devuelve si se pudo (sin espacio o demasiado grande: no). */
export function writeBackup(storage: BackupStorage | undefined, project: Project, revision: number, now: number, maxChars = MAX_BACKUP_CHARS): boolean {
  if (!storage) return false;
  try {
    const text = serializeBackup(project, revision, now, maxChars);
    if (text === undefined) {
      // Demasiado grande: mejor sin respaldo que con uno viejo.
      storage.removeItem(backupKey(project.id));
      return false;
    }
    storage.setItem(backupKey(project.id), text);
    return true;
  } catch {
    return false;
  }
}

export function readBackup(storage: BackupStorage | undefined, projectId: string): UnsavedBackup | undefined {
  if (!storage) return undefined;
  try {
    const backup = parseBackup(storage.getItem(backupKey(projectId)));
    return backup?.projectId === projectId ? backup : undefined;
  } catch {
    return undefined;
  }
}

export function clearBackup(storage: BackupStorage | undefined, projectId: string): void {
  try {
    storage?.removeItem(backupKey(projectId));
  } catch {
    // sin almacenamiento: nada que borrar
  }
}

/**
 * Proyecto del respaldo si es más reciente que lo guardado en IndexedDB: hecho sobre la misma
 * revisión (si IndexedDB tiene una posterior, ya se guardó después), no anterior a la última
 * edición guardada y con contenido distinto. Lleva la revisión de lo guardado para que el
 * guardado automático lo escriba encima sin conflicto. undefined si no hay que aplicarlo.
 */
export function newerBackup(backup: UnsavedBackup | undefined, stored: Project): Project | undefined {
  if (!backup || backup.projectId !== stored.id) return undefined;
  const storedRevision = stored.revision ?? 0;
  if (backup.revision !== storedRevision) return undefined;
  const storedAt = Date.parse(stored.updatedAt);
  if (Number.isFinite(storedAt) && backup.savedAt < storedAt) return undefined;
  let project: Project;
  try {
    project = parseProject(JSON.parse(backup.json));
  } catch {
    return undefined;
  }
  if (project.id !== stored.id || contentHash(project) === contentHash(stored)) return undefined;
  return { ...project, revision: storedRevision };
}

/** localStorage si existe y se puede usar (modo privado, cookies bloqueadas...). */
export function browserStorage(): BackupStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
