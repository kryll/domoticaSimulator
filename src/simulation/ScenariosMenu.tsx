import { Suspense, lazy, useEffect, useRef } from 'react';
import { useSimulationStore } from '../store/simulationStore';
import { useExtrasStore } from '../store/extrasStore';
import { hasFailures } from '../ui/failures';
import { cx } from '../ui/cx';

const ScenariosMenuBody = lazy(() => import('./ScenariosMenuBody').then((m) => ({ default: m.ScenariosMenuBody })));

/**
 * Menú «Escenarios» de la barra superior: activa fallos simulados (Internet, luz, HA, hubs).
 * Con `showTrigger=false` solo pinta el desplegable, que se abre desde «☰ Proyecto».
 */
export function ScenariosMenu({ showTrigger = true }: { showTrigger?: boolean }) {
  const open = useExtrasStore((s) => s.scenariosOpen);
  const setOpen = useExtrasStore((s) => s.setScenariosOpen);
  const active = useSimulationStore((s) => hasFailures(s.sim.failures));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector<HTMLElement>('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <div ref={ref} className={showTrigger ? 'relative' : 'absolute left-0 top-full'}>
      {showTrigger && (
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(!open)}
          className={cx(
            'flex items-center gap-1 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
            active ? 'border-red-400 bg-red-50 text-red-800 hover:bg-red-100' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          {active && <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />}
          Escenarios ▾{active && <span className="sr-only"> (fallos activos)</span>}
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Escenarios de fallo"
          className="absolute left-0 z-40 mt-1 w-72 rounded-md border border-slate-200 bg-white p-2 shadow-lg"
        >
          <Suspense fallback={<p className="p-2 text-xs text-slate-500">Cargando…</p>}>
            <ScenariosMenuBody onDone={() => setOpen(false)} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
