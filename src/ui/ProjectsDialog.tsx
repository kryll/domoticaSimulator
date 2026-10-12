import { useEffect, useState } from 'react';
import { deleteProject, listProjects, loadProject } from '../store/persistence';
import { useProjectStore } from '../store/projectStore';
import { openProject } from '../store/bootstrap';
import { useUiStore } from '../store/uiStore';
import { deleteProjectVersions } from '../store/versions';
import { Button } from './Button';
import { Modal } from './Modal';
import { EmptyState } from './Panel';
import { confirmDialog } from './confirm';

type Summary = Awaited<ReturnType<typeof listProjects>>[number];

/** Diálogo para abrir o borrar proyectos guardados en el navegador. */
export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const currentId = useProjectStore((s) => s.project.id);
  const currentName = useProjectStore((s) => s.project.name);
  const currentUpdated = useProjectStore((s) => s.project.updatedAt);
  const [stored, setItems] = useState<Summary[] | null>(null);
  // El proyecto abierto siempre aparece, aunque aún no se haya guardado (p. ej. la demo recién abierta).
  const items =
    stored === null || stored.some((p) => p.id === currentId)
      ? stored
      : [{ id: currentId, name: currentName, updatedAt: currentUpdated }, ...stored];

  const refresh = () => {
    listProjects()
      .then(setItems)
      .catch(() => setItems([]));
  };
  useEffect(refresh, []);

  const open = async (id: string) => {
    if (id === currentId) {
      onClose();
      return;
    }
    const project = await loadProject(id);
    if (!project) {
      useUiStore.getState().notify('No se pudo abrir el proyecto', 'error');
      return;
    }
    openProject(project);
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
                  const ok = await confirmDialog({
                    title: `¿Borrar el proyecto «${p.name}»?`,
                    message: 'Se borrará del navegador junto con su historial de versiones. No se puede deshacer.',
                    confirmLabel: 'Borrar',
                    danger: true,
                  });
                  if (!ok) return;
                  await deleteProject(p.id);
                  await deleteProjectVersions(p.id).catch((err: unknown) => console.error('No se pudo borrar el historial de versiones', err));
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
