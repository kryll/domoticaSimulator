import { useMemo, useState } from 'react';
import type { EntityState, Scene } from '../types';
import { captureSceneEntities } from '../simulation/scenes';
import { ActuatorControl } from '../simulation/controls/ActuatorControl';
import { formatState } from '../canvas/style';
import { EntityPicker } from '../automations/EntityPicker';
import { sceneTargetAfterService } from './sceneTarget';
import { SCENE_DOMAINS, labeledEntities } from './sceneEntities';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { EmptyState } from '../ui/Panel';
import { cx } from '../ui/cx';
import { ActionListEditor } from '../automations/ActionEditor';
import { SceneCreator } from './SceneCreator';

function describeTarget(st: EntityState, unit?: string): string {
  const base = formatState(st, unit);
  const a = st.attributes ?? {};
  const extra: string[] = [];
  if (typeof a.brightness === 'number') extra.push(`${Math.round((a.brightness / 255) * 100)} %`);
  if (typeof a.current_position === 'number') extra.push(`${a.current_position} %`);
  if (typeof a.temperature === 'number') extra.push(`${a.temperature} °C`);
  if (typeof a.color_temp_kelvin === 'number') extra.push(`${a.color_temp_kelvin} K`);
  if (typeof a.volume_level === 'number') extra.push(`vol. ${Math.round(a.volume_level * 100)} %`);
  return extra.length > 0 ? `${base} · ${extra.join(' · ')}` : base;
}

/** Editor del estado objetivo de cada entidad de una escena. */
function SceneEditor({ scene }: { scene: Scene }) {
  const project = useProjectStore((s) => s.project);
  const updateScene = useProjectStore((s) => s.updateScene);
  const [adding, setAdding] = useState('');
  const refs = useMemo(() => new Map(labeledEntities(project).map((r) => [r.entityId, r])), [project]);
  const setEntities = (entities: Scene['entities']) => updateScene(scene.id, { entities });
  const ids = Object.keys(scene.entities);

  const add = () => {
    if (!adding || scene.entities[adding]) return;
    const { sim } = useSimulationStore.getState();
    setEntities({ ...scene.entities, ...captureSceneEntities(sim, [adding]) });
    setAdding('');
  };

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-2">
      {ids.length === 0 && <p className="text-xs text-slate-500">La escena no tiene entidades.</p>}
      <ul className="flex flex-col gap-2" aria-label={`Entidades de ${scene.name}`}>
        {ids.map((id) => {
          const target = scene.entities[id];
          const ref = refs.get(id);
          if (!target) return null;
          return (
            <li key={id} className="rounded-md border border-slate-200 p-2">
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-800" title={id}>
                    {ref?.label ?? id}
                  </div>
                  <div className="text-[11px] text-slate-500">Objetivo: {describeTarget(target, ref?.definition.unit)}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Quitar ${ref?.label ?? id} de la escena`}
                  onClick={() => {
                    const next = { ...scene.entities };
                    delete next[id];
                    setEntities(next);
                  }}
                >
                  Quitar
                </Button>
              </div>
              {ref ? (
                <ActuatorControl
                  entityId={id}
                  definition={ref.definition}
                  state={target}
                  target
                  onService={(service, data) =>
                    setEntities({
                      ...scene.entities,
                      [id]: sceneTargetAfterService(id, target, service, data, ref.definition.capabilities),
                    })
                  }
                />
              ) : (
                <p className="text-[11px] text-red-700">La entidad ya no existe en el proyecto.</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <EntityPicker label="Añadir entidad" value={adding} onChange={setAdding} domains={SCENE_PICKER_DOMAINS} />
        </div>
        <Button size="sm" onClick={add} disabled={!adding || Boolean(scene.entities[adding])}>
          Añadir
        </Button>
      </div>
      <Button
        size="sm"
        variant="ghost"
        title="Sustituye los objetivos por el estado actual de la simulación"
        onClick={() => setEntities(captureSceneEntities(useSimulationStore.getState().sim, ids))}
        disabled={ids.length === 0}
      >
        ⟳ Recapturar el estado actual
      </Button>
    </div>
  );
}

const SCENE_PICKER_DOMAINS = [...SCENE_DOMAINS];

function ScenesList() {
  const scenes = useProjectStore((s) => s.project.scenes);
  const updateScene = useProjectStore((s) => s.updateScene);
  const removeScene = useProjectStore((s) => s.removeScene);
  const activate = useSimulationStore((s) => s.activateScene);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

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
              <Button
                size="sm"
                aria-expanded={editing === scene.id}
                aria-label={`Editar escena ${scene.name}`}
                onClick={() => setEditing(editing === scene.id ? null : scene.id)}
              >
                {editing === scene.id ? 'Cerrar' : 'Editar'}
              </Button>
              <Button size="sm" variant="danger" aria-label={`Eliminar escena ${scene.name}`} onClick={() => removeScene(scene.id)}>
                ✕
              </Button>
            </div>
            {editing === scene.id ? (
              <SceneEditor scene={scene} />
            ) : (
              <SceneSummary scene={scene} />
            )}
          </li>
        ))}
      </ul>
      {creating && <SceneCreator onClose={() => setCreating(false)} />}
    </section>
  );
}

function SceneSummary({ scene }: { scene: Scene }) {
  const project = useProjectStore((s) => s.project);
  const refs = useMemo(() => new Map(labeledEntities(project).map((r) => [r.entityId, r])), [project]);
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {Object.entries(scene.entities).map(([id, st]) => (
        <li key={id} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700" title={id}>
          {refs.get(id)?.label ?? id}: <strong>{describeTarget(st, refs.get(id)?.definition.unit)}</strong>
        </li>
      ))}
    </ul>
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
