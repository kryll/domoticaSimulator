import type { Project } from '../types';
import { createDemoProject, listProjects, loadProject, loadRawProject, saveProject } from './persistence';
import { browserStorage, clearBackup, newerBackup, readBackup } from './unloadBackup';
import { useProjectStore } from './projectStore';
import { useSimulationStore } from './simulationStore';
import { useUiStore } from './uiStore';
import { useExtrasStore } from './extrasStore';

const LAST_PROJECT_KEY = 'ha-simulator:last-project-id';

/** id del último proyecto abierto (localStorage puede no estar disponible). */
export function lastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function rememberLastProjectId(id: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // sin almacenamiento local: se usará el más reciente
  }
}

/**
 * Abre un proyecto: lo carga en el store, limpia la interfaz y reinicia la simulación.
 * `remember: false` no lo marca como el último abierto (la demo provisional mientras se decide
 * qué hacer con un proyecto ilegible).
 */
export function openProject(project: Project, remember = true): void {
  useProjectStore.getState().loadProject(project);
  useUiStore.getState().reset();
  // Lo que depende del proyecto anterior (routers sugeridos, menú de planta) no se conserva.
  useExtrasStore.getState().setRouterSuggestion(null);
  useExtrasStore.getState().openFloorMenu(null);
  useUiStore.getState().setActiveFloor(project.floors[0]?.id ?? null);
  useSimulationStore.getState().reset(project);
  if (remember) rememberLastProjectId(project.id);
}

/** Si ya hay guardado un proyecto con el mismo id, devuelve una copia con id nuevo. */
export async function withUniqueId(project: Project): Promise<Project> {
  const existing = await listProjects().catch(() => []);
  if (!existing.some((p) => p.id === project.id)) return project;
  return { ...project, id: crypto.randomUUID() };
}

/** Abre un proyecto importado o de demo sin sobrescribir uno guardado con el mismo id. */
export async function openAsNewProject(project: Project): Promise<Project> {
  const unique = await withUniqueId(project);
  await saveProject(unique).catch((err: unknown) => console.error('No se pudo guardar el proyecto', err));
  openProject(unique);
  return unique;
}

export interface UnreadableProject {
  id: string;
  name: string;
  /** Mensaje de parseProject. */
  error: string;
  /** Lo guardado tal cual (para descargarlo o repararlo). Nunca se sobrescribe. */
  raw: unknown;
}

export interface InitialLoad {
  /** No había ningún proyecto guardado: es la primera visita. */
  firstRun: boolean;
  /** El último proyecto no se puede leer: se abre la demo sin guardar y se ofrece recuperarlo. */
  unreadable?: UnreadableProject;
  /** Se aplicó el respaldo de cierre (cambios de los últimos instantes que no llegaron a IndexedDB). */
  restoredBackup?: boolean;
}

/**
 * Carga el último proyecto abierto (o el más reciente) o, si no hay ninguno, el de demo. La demo
 * se guarda en IndexedDB al abrirse (no solo tras la primera edición) para que otra pestaña abra
 * el mismo proyecto. Si el proyecto no se puede leer, no se toca lo guardado: se abre una demo
 * provisional (sin guardar ni recordar) y se devuelve `unreadable` para ofrecer recuperarlo.
 */
export async function loadInitialProject(): Promise<InitialLoad> {
  let firstRun = true;
  try {
    const list = await listProjects();
    firstRun = list.length === 0;
    const remembered = lastProjectId();
    const target = list.find((p) => p.id === remembered) ?? [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (target) {
      let project: Project | undefined;
      try {
        project = await loadProject(target.id);
      } catch (err) {
        const raw = await loadRawProject(target.id).catch(() => undefined);
        console.error('El proyecto guardado no se puede leer', err);
        const demo = createDemoProject();
        openProject(demo, false);
        return { firstRun: false, unreadable: { id: target.id, name: target.name, error: err instanceof Error ? err.message : String(err), raw } };
      }
      if (project) {
        // Cambios de los últimos instantes guardados al cerrar (localStorage) y no en IndexedDB.
        const storage = browserStorage();
        const backup = newerBackup(readBackup(storage, project.id), project);
        if (backup) {
          openProject(backup);
          useProjectStore.getState().setSaveState({ dirty: true, baseRevision: project.revision ?? 0 });
          return { firstRun: false, restoredBackup: true };
        }
        clearBackup(storage, project.id);
        openProject(project);
        return { firstRun: false };
      }
    }
  } catch (err) {
    console.error('No se pudieron leer los proyectos guardados', err);
  }
  const demo = createDemoProject();
  await saveProject(demo).catch((err: unknown) => console.error('No se pudo guardar el proyecto de demo', err));
  openProject(demo);
  return { firstRun };
}
