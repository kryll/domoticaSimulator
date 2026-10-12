import { useState } from 'react';
import { knownDefinitions } from '../canvas/analysis';
import { countLabel } from '../ui/plural';
import type { Timeline, TimelineStep } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { recordTimeline, runTimeline, timelineStart, type TimelineRun } from '../simulation/timeline';
import { formatSimTime, startOfDay } from '../simulation/clock';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { confirmDialog } from '../ui/confirm';

/** Resultado de la última ejecución por prueba (se pierde al cambiar de proyecto). */
const lastRuns = new Map<string, { run: TimelineRun; steps: TimelineStep[]; startAt: number | undefined }>();

/** «Grabar desde el registro», «Ejecutar» y la lista de resultados ✓/✗ (B14). */
export function TimelineRunner({ timeline, onRecorded }: { timeline: Timeline; onRecorded: (steps: TimelineStep[], startAt: number) => void }) {
  const [, force] = useState(0);
  const cached = lastRuns.get(timeline.id);
  // El resultado solo vale si los pasos y el inicio no han cambiado desde la ejecución.
  const run = cached && cached.steps === timeline.steps && cached.startAt === timeline.startAt ? cached.run : null;

  const execute = () => {
    const project = useProjectStore.getState().project;
    // Desde el inicio guardado en la prueba o, si no tiene, desde las 00:00 del día simulado.
    const start = timelineStart(timeline, startOfDay(useSimulationStore.getState().sim.now));
    try {
      const result = runTimeline(project, knownDefinitions(), timeline, start);
      lastRuns.set(timeline.id, { run: result, steps: timeline.steps, startAt: timeline.startAt });
      force((n) => n + 1);
    } catch (err) {
      useUiStore.getState().notify(`No se pudo ejecutar la prueba: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const record = async () => {
    const { log, now } = useSimulationStore.getState().sim;
    const steps = recordTimeline(log);
    if (steps.length === 0) {
      useUiStore.getState().notify('El registro no tiene eventos que grabar: usa los dispositivos con la simulación y vuelve a intentarlo', 'info');
      return;
    }
    if (
      timeline.steps.length > 0 &&
      !(await confirmDialog({
        title: `¿Sustituir los pasos de «${timeline.name}»?`,
        message: `Se sustituirán ${countLabel(timeline.steps.length, 'paso actual', 'pasos actuales').toLowerCase()} por ${countLabel(steps.length, 'paso grabado', 'pasos grabados').toLowerCase()}.`,
        confirmLabel: 'Sustituir',
      }))
    )
      return;
    // La prueba grabada empieza el día de la primera entrada del registro.
    onRecorded(steps, startOfDay(log[0]?.timestamp ?? now));
    useUiStore.getState().notify(`${countLabel(steps.length, 'paso grabado', 'pasos grabados')} desde el registro`, 'success');
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
            {run.passed ? `✓ Superada (${countLabel(asserts.length, 'comprobación', 'comprobaciones')})` : `✗ ${failed.length} ${failed.length === 1 ? 'fallo' : 'fallos'}`}
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
