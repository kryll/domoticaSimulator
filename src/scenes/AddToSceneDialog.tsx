import { useId, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { captureSceneEntities } from '../simulation/scenes';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SceneCreator } from './SceneCreator';

const NEW = '__nueva__';

/** «Añadir a escena» desde el menú contextual: elige escena existente o crea una nueva. */
export function AddToSceneDialog() {
  const entityIds = useUiStore((s) => s.addToScene);
  const close = useUiStore((s) => s.setAddToScene);
  if (!entityIds) return null;
  return <AddToSceneBody entityIds={entityIds} onClose={() => close(null)} />;
}

function AddToSceneBody({ entityIds, onClose }: { entityIds: string[]; onClose: () => void }) {
  const scenes = useProjectStore((s) => s.project.scenes);
  const updateScene = useProjectStore((s) => s.updateScene);
  const [choice, setChoice] = useState<string>(scenes[0]?.id ?? NEW);
  const [creating, setCreating] = useState(false);
  const name = useId();

  if (creating) return <SceneCreator initial={entityIds} onClose={onClose} />;

  const apply = () => {
    if (choice === NEW) {
      setCreating(true);
      return;
    }
    const scene = scenes.find((s) => s.id === choice);
    if (!scene) return;
    const captured = captureSceneEntities(useSimulationStore.getState().sim, entityIds);
    updateScene(scene.id, { entities: { ...scene.entities, ...captured } });
    useUiStore.getState().notify(`Añadido a la escena «${scene.name}» con su estado actual`, 'success');
    onClose();
  };

  return (
    <Modal
      open
      title="Añadir a escena"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={apply}>
            {choice === NEW ? 'Continuar' : 'Añadir'}
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs text-slate-500">Se guardará el estado actual de la simulación como objetivo.</legend>
        {scenes.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name={name} value={s.id} checked={choice === s.id} onChange={() => setChoice(s.id)} />
            {s.name}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={name} value={NEW} checked={choice === NEW} onChange={() => setChoice(NEW)} />
          Nueva escena…
        </label>
      </fieldset>
    </Modal>
  );
}
