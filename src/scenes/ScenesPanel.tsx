import { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { EmptyState } from '../ui/Panel';
import { cx } from '../ui/cx';
import { ActionListEditor } from '../automations/ActionEditor';
import { SceneCreator } from './SceneCreator';

function ScenesList() {
  const scenes = useProjectStore((s) => s.project.scenes);
  const updateScene = useProjectStore((s) => s.updateScene);
  const removeScene = useProjectStore((s) => s.removeScene);
  const activate = useSimulationStore((s) => s.activateScene);
  const [creating, setCreating] = useState(false);

  return (
    <section className="flex min-h-0 flex-col" aria-labelledby="scenes-title">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h3 id="scenes-title" className="text-sm font-semibold text-slate-700">
          Escenas
        </h3>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          + Nueva escena
        </Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto p-2" aria-label="Lista de escenas">
        {scenes.length === 0 && <EmptyState>No hay escenas.</EmptyState>}
        {scenes.map((scene) => (
          <li key={scene.id} className="mb-2 rounded-md border border-slate-200 p-2">
            <div className="flex items-end gap-2">
              <TextField
                label="Nombre"
                hideLabel
                value={scene.name}
                onChange={(e) => updateScene(scene.id, { name: e.target.value })}
                fieldClassName="flex-1"
              />
              <Button size="sm" variant="primary" onClick={() => activate(scene.id)}>
                Activar
              </Button>
              <Button size="sm" variant="danger" aria-label={`Eliminar escena ${scene.name}`} onClick={() => removeScene(scene.id)}>
                ✕
              </Button>
            </div>
            <ul className="mt-1 flex flex-wrap gap-1">
              {Object.entries(scene.entities).map(([id, st]) => (
                <li key={id} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                  <code>{id}</code>: <strong>{String(st.state)}</strong>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {creating && <SceneCreator onClose={() => setCreating(false)} />}
    </section>
  );
}

function ScriptsList() {
  const scripts = useProjectStore((s) => s.project.scripts);
  const addScript = useProjectStore((s) => s.addScript);
  const updateScript = useProjectStore((s) => s.updateScript);
  const removeScript = useProjectStore((s) => s.removeScript);
  const run = useSimulationStore((s) => s.runScript);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = scripts.find((s) => s.id === selectedId) ?? scripts[0];

  return (
    <section className="flex min-h-0 flex-col" aria-labelledby="scripts-title">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h3 id="scripts-title" className="text-sm font-semibold text-slate-700">
          Scripts
        </h3>
        <Button size="sm" variant="primary" onClick={() => setSelectedId(addScript().id)}>
          + Nuevo script
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <ul className="w-44 shrink-0 overflow-auto border-r border-slate-200" aria-label="Lista de scripts">
          {scripts.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSelectedId(s.id)}
                aria-current={selected?.id === s.id ? 'true' : undefined}
                className={cx(
                  'w-full truncate px-3 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500',
                  selected?.id === s.id ? 'bg-sky-50 font-medium text-sky-800' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 overflow-auto p-2">
          {selected ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-end gap-2">
                <TextField
                  label="Nombre del script"
                  value={selected.name}
                  onChange={(e) => updateScript(selected.id, { name: e.target.value })}
                  fieldClassName="flex-1"
                />
                <Button size="sm" variant="primary" onClick={() => run(selected.id)}>
                  ▶ Ejecutar
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    removeScript(selected.id);
                    setSelectedId(null);
                  }}
                >
                  Eliminar
                </Button>
              </div>
              <ActionListEditor
                key={selected.id}
                title="Secuencia"
                actions={selected.sequence}
                onChange={(sequence) => updateScript(selected.id, { sequence })}
              />
            </div>
          ) : (
            <EmptyState>No hay scripts.</EmptyState>
          )}
        </div>
      </div>
    </section>
  );
}

/** Pestaña "Escenas y scripts". */
export function ScenesPanel() {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
      <ScenesList />
      <ScriptsList />
    </div>
  );
}
