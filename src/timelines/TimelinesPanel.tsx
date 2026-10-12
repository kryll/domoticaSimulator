import { useState } from 'react';
import type { Timeline, TimelineStep } from '../types';
import { useProjectStore } from '../store/projectStore';
import { ListEditor } from '../automations/ListEditor';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { EmptyState } from '../ui/Panel';
import { cx } from '../ui/cx';
import { addTimeline, updateTimeline } from './timelineActions';
import { TimelineStepEditor } from './TimelineStepEditor';
import { TimelineRunner } from './TimelineRunner';

const EMPTY: Timeline[] = [];

function lastTime(steps: TimelineStep[]): string {
  return steps[steps.length - 1]?.at ?? '08:00:00';
}

function TimelineEditor({ timeline }: { timeline: Timeline }) {
  const at = lastTime(timeline.steps);
  return (
    <div className="flex flex-col gap-3">
      <TextField
        key={timeline.name}
        label="Nombre de la prueba"
        defaultValue={timeline.name}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== timeline.name) updateTimeline(timeline.id, { name: v });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <ListEditor<TimelineStep>
        title="Pasos"
        items={timeline.steps}
        onChange={(steps) => updateTimeline(timeline.id, { steps })}
        renderItem={(step, update) => <TimelineStepEditor value={step} onChange={update} />}
        addOptions={[
          { label: 'Evento', create: () => ({ at, kind: 'event', event: 'state', entityId: '', value: 'on' }) },
          { label: 'Comprobación', create: () => ({ at, kind: 'assert', entityId: '', expect: 'on', op: 'eq' }) },
        ]}
        emptyText="Añade eventos (lo que pasa) y comprobaciones (lo que debería pasar)."
      />
    </div>
  );
}

/** Pestaña «Pruebas»: líneas de tiempo con eventos y aserciones (B14). */
export function TimelinesPanel() {
  const timelines = useProjectStore((s) => s.project.timelines ?? EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = timelines.find((t) => t.id === selectedId) ?? timelines[0];

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-56 shrink-0 flex-col border-r border-slate-200">
        <div className="flex flex-col gap-1 p-2">
          <Button variant="primary" size="sm" onClick={() => setSelectedId(addTimeline().id)}>
            + Nueva prueba
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto" aria-label="Pruebas">
          {timelines.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelectedId(t.id)}
                aria-current={selected?.id === t.id ? 'true' : undefined}
                className={cx(
                  'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500',
                  selected?.id === t.id ? 'bg-sky-50 font-medium text-sky-800' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className="truncate">{t.name}</span>
                <span className="text-xs text-slate-500">{t.steps.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-auto p-3">
        {selected ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <TimelineRunner timeline={selected} onRecorded={(steps) => updateTimeline(selected.id, { steps })} />
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (!window.confirm(`¿Eliminar la prueba «${selected.name}»?`)) return;
                  useProjectStore.getState().update((p) => ({ ...p, timelines: (p.timelines ?? []).filter((t) => t.id !== selected.id) }));
                  setSelectedId(null);
                }}
              >
                Eliminar
              </Button>
            </div>
            <TimelineEditor key={selected.id} timeline={selected} />
          </div>
        ) : (
          <EmptyState>No hay pruebas. Crea una línea de tiempo o grábala desde el registro de la simulación.</EmptyState>
        )}
      </div>
    </div>
  );
}
