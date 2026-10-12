// Resolución del conflicto entre pestañas (diálogo «Este proyecto se ha modificado en otra pestaña»).
import type { Project } from '../types';
import { autosaveDeps, saveNow } from './autosave';
import { openProject, rememberLastProjectId } from './bootstrap';
import { useProjectStore } from './projectStore';

async function latestSaved(): Promise<Project | undefined> {
  const { project, conflict } = useProjectStore.getState();
  const fresh = await autosaveDeps().load(project.id);
  return fresh ?? conflict?.current;
}

/** «Cargar la versión más reciente»: descarta lo de esta pestaña y abre lo guardado. */
export async function loadLatestVersion(): Promise<boolean> {
  const latest = await latestSaved();
  if (!latest) return false;
  openProject(latest);
  return true;
}

/** «Mantener la mía y sobrescribir»: guarda esta versión encima de la de la otra pestaña. */
export async function overwriteWithMine(): Promise<void> {
  const latest = await latestSaved();
  const { conflict, baseRevision } = useProjectStore.getState();
  const revision = latest?.revision ?? conflict?.revision ?? baseRevision;
  useProjectStore.getState().setSaveState({ baseRevision: revision, conflict: null, dirty: true });
  await saveNow();
}

/** «Guardar la mía como copia»: esta pestaña pasa a trabajar en un proyecto nuevo con lo suyo. */
export async function saveMineAsCopy(): Promise<Project | null> {
  const { project } = useProjectStore.getState();
  const copy: Project = { ...project, id: crypto.randomUUID(), name: `${project.name} (copia)`, updatedAt: new Date().toISOString() };
  delete copy.revision;
  const result = await autosaveDeps().save(copy, 0);
  if (!result.ok) return null;
  useProjectStore.getState().loadProject({ ...copy, revision: result.revision });
  rememberLastProjectId(copy.id);
  return copy;
}
