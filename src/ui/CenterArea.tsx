import { Suspense, lazy } from 'react';
import { Canvas } from '../canvas/Canvas';
import { useExtrasStore } from '../store/extrasStore';
import { cx } from './cx';

const DashboardView = lazy(() => import('../dashboard/DashboardView').then((m) => ({ default: m.DashboardView })));

/** Área central: el plano o el dashboard. El lienzo sigue montado para conservar el encuadre. */
export function CenterArea() {
  const view = useExtrasStore((s) => s.centerView);
  return (
    <div className="relative min-h-0 flex-1">
      <div className={cx('h-full', view === 'dashboard' && 'hidden')}>
        <Canvas />
      </div>
      {view === 'dashboard' && (
        <div className="absolute inset-0 overflow-hidden" role="region" aria-label="Dashboard">
          <Suspense fallback={<p className="px-3 py-6 text-center text-sm text-slate-500">Cargando…</p>}>
            <DashboardView />
          </Suspense>
        </div>
      )}
    </div>
  );
}

/** Selector «Plano | Dashboard» del área central. */
export function CenterViewSwitch() {
  const view = useExtrasStore((s) => s.centerView);
  const setView = useExtrasStore((s) => s.setCenterView);
  return (
    <div role="group" aria-label="Vista del área central" className="ml-auto flex shrink-0 rounded-md bg-slate-200/70 p-0.5">
      {(
        [
          ['plan', 'Plano'],
          ['dashboard', 'Dashboard'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          onClick={() => setView(key)}
          className={cx(
            'rounded px-2.5 py-0.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
            view === key ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
