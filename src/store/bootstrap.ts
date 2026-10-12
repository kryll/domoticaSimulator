import type { Project } from '../types';
import { createDemoProject, listProjects, loadProject, saveProject } from './persistence';
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

/** Abre un proyecto: lo carga en el store, limpia la interfaz y reinicia la simulación. */
export function openProject(project: Project): void {
  useProjectStore.getState().loadProject(project);
  useUiStore.getState().reset();
  // Lo que depende del proyecto anterior (routers sugeridos, menú de planta) no se conserva.
  useExtrasStore.getState().setRouterSuggestion(null);
  useExtrasStore.getState().openFloorMenu(null);
  useUiStore.getState().setActiveFloor(project.floors[0]?.id ?? null);
  useSimulationStore.getState().reset(project);
  rememberLastProjectId(project.id);
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

export interface InitialLoad {
  /** No había ningún proyecto guardado: es la primera visita. */
  firstRun: boolean;
}

/**
 * Carga el último proyecto abierto (o el más reciente) o, si no hay ninguno, el de demo. La demo
 * se guarda en IndexedDB al abrirse (no solo tras la primera edición) para que otra pestaña abra
 * el mismo proyecto.
 */
export async function loadInitialProject(): Promise<InitialLoad> {
  let firstRun = true;
  try {
    const list = await listProjects();
    firstRun = list.length === 0;
    const remembered = lastProjectId();
    const target = list.find((p) => p.id === remembered) ?? [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (target) {
      const project = await loadProject(target.id);
      if (project) {
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
