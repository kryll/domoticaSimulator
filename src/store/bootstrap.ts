import { createDemoProject, listProjects, loadProject } from './persistence';
import { useProjectStore } from './projectStore';

/** Carga el último proyecto guardado o, si no hay ninguno, el de demo. */
export async function loadInitialProject(): Promise<void> {
  try {
    const list = await listProjects();
    const latest = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest) {
      const project = await loadProject(latest.id);
      if (project) {
        useProjectStore.getState().loadProject(project);
        return;
      }
    }
  } catch (err) {
    console.error('No se pudieron leer los proyectos guardados', err);
  }
  useProjectStore.getState().loadProject(createDemoProject());
}
