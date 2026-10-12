import { useMemo, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { captureSceneEntities } from '../simulation/scenes';
import { entityStateText } from '../ui/stateText';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { TextField } from '../ui/Field';
import { SCENE_DOMAINS, labeledEntities } from './sceneEntities';

/** Diálogo para crear una escena capturando el estado actual de las entidades elegidas. */
export function SceneCreator({ onClose, initial = [] }: { onClose: () => void; initial?: string[] }) {
  const project = useProjectStore((s) => s.project);
  const addScene = useProjectStore((s) => s.addScene);
  const entities = useSimulationStore((s) => s.sim.entities);
  const [name, setName] = useState(`Escena ${project.scenes.length + 1}`);
  const [checked, setChecked] = useState<Set<string>>(new Set(initial));
  const [showAll, setShowAll] = useState(false);

  const refs = useMemo(
    () => labeledEntities(project, (r) => showAll || SCENE_DOMAINS.has(r.definition.domain)),
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
    const { sim } = useSimulationStore.getState();
    addScene({ name: name.trim() || 'Escena', entities: captureSceneEntities(sim, [...checked]) });
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
          Marca las entidades a incluir: se guardará su estado actual en la simulación. Después podrás ajustar el estado
          objetivo de cada una.
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
              <label className="flex items-center gap-2 text-sm" title={r.entityId}>
                <input type="checkbox" checked={checked.has(r.entityId)} onChange={() => toggle(r.entityId)} />
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="text-xs font-semibold text-slate-700">{entityStateText(r.entityId, entities[r.entityId], r.definition)}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
