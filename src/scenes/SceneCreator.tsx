import { useMemo, useState } from 'react';
import type { EntityState } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { projectEntities } from '../canvas/analysis';
import { formatState } from '../canvas/style';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { TextField } from '../ui/Field';

/** Domínios cuyo estado tiene sentido guardar en una escena. */
const SCENE_DOMAINS = new Set(['light', 'switch', 'cover', 'climate', 'media_player', 'fan', 'lock', 'vacuum']);

/** Diálogo para crear una escena capturando el estado actual de las entidades elegidas. */
export function SceneCreator({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const addScene = useProjectStore((s) => s.addScene);
  const entities = useSimulationStore((s) => s.sim.entities);
  const [name, setName] = useState(`Escena ${project.scenes.length + 1}`);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const refs = useMemo(
    () => projectEntities(project).filter((r) => showAll || SCENE_DOMAINS.has(r.definition.domain)),
    [project, showAll],
  );

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = () => {
    const captured: Record<string, EntityState> = {};
    for (const id of checked) {
      const st = entities[id];
      if (st) captured[id] = { state: st.state, ...(st.attributes ? { attributes: { ...st.attributes } } : {}) };
    }
    addScene({ name: name.trim() || 'Escena', entities: captured });
    onClose();
  };

  return (
    <Modal
      open
      title="Nueva escena"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={create} disabled={checked.size === 0}>
            Capturar estado y crear
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="Nombre de la escena" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="text-xs text-slate-500">
          Marca las entidades a incluir: se guardará su estado actual en la simulación.
        </p>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Mostrar también sensores
        </label>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setChecked(new Set(refs.map((r) => r.entityId)))}>
            Marcar todas
          </Button>
          <Button size="sm" onClick={() => setChecked(new Set())}>
            Ninguna
          </Button>
        </div>
        <ul className="flex max-h-72 flex-col gap-1 overflow-auto" aria-label="Entidades para la escena">
          {refs.length === 0 && <li className="text-sm text-slate-500">No hay entidades en el proyecto.</li>}
          {refs.map((r) => (
            <li key={r.entityId}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={checked.has(r.entityId)} onChange={() => toggle(r.entityId)} />
                <span className="min-w-0 flex-1 truncate">
                  {r.friendlyName} <code className="text-[11px] text-slate-500">{r.entityId}</code>
                </span>
                <span className="text-xs font-semibold text-slate-700">
                  {formatState(entities[r.entityId], r.definition.unit)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
