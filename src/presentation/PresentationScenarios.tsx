import { Suspense, lazy, useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { catalog } from '../devices/catalog';
import { FAILURE_SCENARIOS } from '../simulation/scenarios';
import { NO_FAILURES, hasFailures } from '../ui/failures';
import { cx } from '../ui/cx';
import { presentationSnapshot } from '../report/presentation';

const ImpactPanel = lazy(() => import('../reports/ImpactPanel').then((m) => ({ default: m.ImpactPanel })));

/** Escenarios en el modo presentación: solo los botones de escenario y el impacto. */
export function PresentationScenarios() {
  const live = useProjectStore((s) => s.project);
  // Copia congelada de solo lectura: los escenarios nunca modifican el proyecto.
  const project = useMemo(() => presentationSnapshot(live), [live]);
  const failures = useSimulationStore((s) => s.sim.failures) ?? NO_FAILURES;
  const setFailures = useSimulationStore((s) => s.setFailures);
  const active = hasFailures(failures);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <section aria-labelledby="scenarios-title">
        <h2 id="scenarios-title" className="mb-2 text-sm font-semibold text-slate-800">
          ¿Qué pasa si…?
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            aria-pressed={!active}
            onClick={() => setFailures(NO_FAILURES)}
            className={cx(
              'rounded-lg border p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600',
              !active ? 'border-emerald-600 bg-emerald-50' : 'border-slate-300 bg-white hover:bg-slate-50',
            )}
          >
            <span className="block text-sm font-semibold text-slate-900">✓ Todo funciona</span>
            <span className="block text-xs text-slate-600">Sin fallos: la casa en condiciones normales.</span>
          </button>
          {FAILURE_SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              type="button"
              onClick={() => setFailures({ ...NO_FAILURES, ...sc.failures(project, catalog) })}
              className="rounded-lg border border-slate-300 bg-white p-3 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <span className="block text-sm font-semibold text-slate-900">{sc.name}</span>
              <span className="block text-xs text-slate-600">{sc.description}</span>
            </button>
          ))}
        </div>
      </section>
      <section aria-label="Impacto" className="rounded-lg border border-slate-200 bg-white">
        <Suspense fallback={<p className="px-3 py-6 text-center text-sm text-slate-600">Cargando…</p>}>
          <ImpactPanel presentation />
        </Suspense>
      </section>
    </div>
  );
}
