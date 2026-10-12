import { useMemo } from 'react';
import type { Project } from '../types';
import { HOUSE_TEMPLATES, createFromTemplate } from '../store/houseTemplates';
import { openAsNewProject } from '../store/bootstrap';
import { useUiStore } from '../store/uiStore';
import { polygonBounds } from '../canvas/geometry';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

/** Miniatura con las salas de la primera planta. */
function Preview({ project }: { project: Project }) {
  const floor = [...project.floors].sort((a, b) => a.level - b.level)[0];
  const rooms = project.rooms.filter((r) => r.floorId === floor?.id);
  const pts = rooms.flatMap((r) => r.polygon);
  if (pts.length === 0) return <div className="h-28 rounded bg-slate-100" aria-hidden="true" />;
  const b = polygonBounds(pts);
  const pad = 10;
  return (
    <svg viewBox={`${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`} className="h-28 w-full rounded bg-slate-50" aria-hidden="true">
      {rooms.map((r) => (
        <polygon key={r.id} points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill="#e0f2fe" stroke="#64748b" strokeWidth={3} />
      ))}
      {project.devices
        .filter((d) => d.floorId === floor?.id)
        .map((d) => (
          <circle key={d.id} cx={d.position.x} cy={d.position.y} r={7} fill="#0284c7" />
        ))}
    </svg>
  );
}

/** «Nuevo desde plantilla de casa»: galería de casas de ejemplo (B18). */
export function HouseTemplatesDialog({ onClose }: { onClose: () => void }) {
  const previews = useMemo(() => HOUSE_TEMPLATES.map((t) => ({ template: t, project: createFromTemplate(t.id) })), []);

  const create = async (id: string) => {
    try {
      const project = await openAsNewProject(createFromTemplate(id));
      useUiStore.getState().notify(`Proyecto «${project.name}» creado desde la plantilla`, 'success');
      onClose();
    } catch (err) {
      useUiStore.getState().notify(`No se pudo crear el proyecto: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  return (
    <Modal open size="xl" title="Nuevo proyecto desde una plantilla de casa" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">El proyecto actual queda guardado en el navegador. La plantilla se abre como un proyecto nuevo.</p>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3" aria-label="Plantillas de casa">
        {previews.map(({ template, project }) => (
          <li key={template.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
            <Preview project={project} />
            <h3 className="text-sm font-semibold text-slate-800">{template.name}</h3>
            <p className="flex-1 text-xs text-slate-600">{template.description}</p>
            <p className="text-xs text-slate-500">
              {project.floors.length} {project.floors.length === 1 ? 'planta' : 'plantas'} · {project.rooms.length} salas · {project.devices.length} dispositivos · {project.automations.length} automatizaciones
            </p>
            <Button variant="primary" size="sm" onClick={() => void create(template.id)} aria-label={`Crear desde ${template.name}`}>
              Crear
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
