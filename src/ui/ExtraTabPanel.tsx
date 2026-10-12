import { Suspense, lazy } from 'react';
import type { BottomTab } from '../store/uiStore';

// Vistas de la Fase 3 cargadas bajo demanda.
const HomePanel = lazy(() => import('../home/HomePanel').then((m) => ({ default: m.HomePanel })));
const TimelinesPanel = lazy(() => import('../timelines/TimelinesPanel').then((m) => ({ default: m.TimelinesPanel })));

function Loading() {
  return <p className="px-3 py-6 text-center text-sm text-slate-500">Cargando…</p>;
}

/** Contenido de las pestañas de la Fase 3 del panel inferior. */
export function ExtraTabPanel({ tab }: { tab: BottomTab }) {
  if (tab !== 'home' && tab !== 'tests') return null;
  return (
    <Suspense fallback={<Loading />}>
      {tab === 'home' && <HomePanel />}
      {tab === 'tests' && <TimelinesPanel />}
    </Suspense>
  );
}
