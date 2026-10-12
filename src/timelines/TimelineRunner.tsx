import { useState } from 'react';
import type { Timeline, TimelineStep } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { catalog } from '../devices/catalog';
import { recordTimeline, runTimeline, type TimelineRun } from '../simulation/timeline';
import { formatSimTime, startOfDay } from '../simulation/clock';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';

/** Resultado de la última ejecución por prueba (se pierde al cambiar de proyecto). */
const lastRuns = new Map<string, { run: TimelineRun; steps: TimelineStep[] }>();

/** «Grabar desde el registro», «Ejecutar» y la lista de resultados ✓/✗ (B14). */
export function TimelineRunner({ timeline, onRecorded }: { timeline: Timeline; onRecorded: (steps: TimelineStep[]) => void }) {
  const [, force] = useState(0);
  const cached = lastRuns.get(timeline.id);
  // El resultado solo vale si los pasos no han cambiado desde la ejecución.
  const run = cached && cached.steps === timeline.steps ? cached.run : null;

  const execute = () => {
    const project = useProjectStore.getState().project;
    const start = startOfDay(useSimulationStore.getState().sim.now);
    try {
      const result = runTimeline(project, catalog, timeline, start);
      lastRuns.set(timeline.id, { run: result, steps: timeline.steps });
      force((n) => n + 1);
    } catch (err) {
      useUiStore.getState().notify(`No se pudo ejecutar la prueba: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const record = () => {
    const steps = recordTimeline(useSimulationStore.getState().sim.log);
    if (steps.length === 0) {
      useUiStore.getState().notify('El registro no tiene eventos que grabar: usa los dispositivos con la simulación y vuelve a intentarlo', 'info');
      return;
    }
    if (timeline.steps.length > 0 && !window.confirm(`¿Sustituir los ${timeline.steps.length} pasos de «${timeline.name}» por los ${steps.length} grabados?`)) return;
    onRecorded(steps);
    useUiStore.getState().notify(`Grabados ${steps.length} pasos desde el registro`, 'success');
  };

  const asserts = run?.results.filter((r) => r.step.kind === 'assert') ?? [];
  const failed = run?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="mr-auto flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={record} title="Convierte lo que has hecho en la simulación en pasos de la prueba">
          ⏺ Grabar desde el registro
        </Button>
        <Button size="sm" variant="primary" onClick={execute} disabled={timeline.steps.length === 0}>
          ▶ Ejecutar
        </Button>
        {run && (
          <span
            role="status"
            className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', run.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800')}
          >
            {run.passed ? `✓ Superada (${asserts.length} comprobaciones)` : `✗ ${failed.length} ${failed.length === 1 ? 'fallo' : 'fallos'}`}
          </span>
        )}
      </div>
      {run && (
        <ol className="flex max-h-48 flex-col overflow-auto rounded border border-slate-200 bg-white text-xs" aria-label="Resultados de la prueba">
          {run.results.map((r) => (
            <li
              key={r.index}
              className={cx('flex gap-2 border-b border-slate-100 px-2 py-1', !r.ok && 'bg-red-50 text-red-800', r.ok && r.step.kind === 'assert' && 'text-emerald-800')}
            >
              <span aria-hidden="true" className="w-4 shrink-0 font-bold">
                {r.ok ? (r.step.kind === 'assert' ? '✓' : '·') : '✗'}
              </span>
              <span className="sr-only">{r.ok ? 'Correcto:' : 'Fallo:'}</span>
              <time className="shrink-0 font-mono text-slate-500">{formatSimTime(r.at, { seconds: true })}</time>
              <span className="min-w-0 flex-1">{r.message}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
