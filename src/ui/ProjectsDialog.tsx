import { useEffect, useState } from 'react';
import { deleteProject, listProjects, loadProject } from '../store/persistence';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Button } from './Button';
import { Modal } from './Modal';
import { EmptyState } from './Panel';

type Summary = Awaited<ReturnType<typeof listProjects>>[number];

/** Diálogo para abrir o borrar proyectos guardados en el navegador. */
export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const currentId = useProjectStore((s) => s.project.id);
  const [items, setItems] = useState<Summary[] | null>(null);

  const refresh = () => {
    listProjects()
      .then(setItems)
      .catch(() => setItems([]));
  };
  useEffect(refresh, []);

  const open = async (id: string) => {
    const project = await loadProject(id);
    if (!project) {
      useUiStore.getState().notify('No se pudo abrir el proyecto', 'error');
      return;
    }
    useProjectStore.getState().loadProject(project);
    useUiStore.getState().reset();
    onClose();
  };

  return (
    <Modal open title="Abrir proyecto" onClose={onClose}>
      {items === null ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : items.length === 0 ? (
        <EmptyState>No hay proyectos guardados.</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">
                  {p.name} {p.id === currentId && <span className="text-xs text-sky-700">(abierto)</span>}
                </div>
                <div className="text-xs text-slate-500">
                  Modificado: {new Date(p.updatedAt).toLocaleString('es-ES')}
                </div>
              </div>
              <Button size="sm" variant="primary" onClick={() => void open(p.id)}>
                Abrir
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={p.id === currentId}
                aria-label={`Borrar ${p.name}`}
                onClick={async () => {
                  if (!window.confirm(`¿Borrar el proyecto "${p.name}"?`)) return;
                  await deleteProject(p.id);
                  refresh();
                }}
              >
                Borrar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
