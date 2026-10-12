import { Suspense, lazy, useEffect } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { useViewStore, type PresentationView as View } from '../store/viewStore';
import { Canvas } from '../canvas/Canvas';
import { SimulationControls } from '../simulation/SimulationControls';
import { FailureBanner } from '../simulation/FailureBanner';
import { Tabs } from '../ui/Tabs';
import { Button } from '../ui/Button';
import { tabPanelId } from '../ui/ids';
import { cx } from '../ui/cx';
import { exitPresentation } from './presentationMode';
import { PresentationScenarios } from './PresentationScenarios';

const DashboardView = lazy(() => import('../dashboard/DashboardView').then((m) => ({ default: m.DashboardView })));

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'plan', label: 'Plano' },
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'scenarios', label: 'Escenarios' },
];

const PREFIX = 'presentation';

/** ¿Hay un diálogo modal abierto encima (que debe recibir el Escape)? */
function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

function FloorTabs() {
  const floors = useProjectStore((s) => s.project.floors);
  const active = useUiStore((s) => s.activeFloorId) ?? floors[0]?.id ?? '';
  if (floors.length < 2) return null;
  return (
    <Tabs<string>
      label="Plantas"
      tabs={[...floors].sort((a, b) => a.level - b.level).map((f) => ({ key: f.id, label: f.name }))}
      active={active}
      onChange={(id) => useUiStore.getState().setActiveFloor(id)}
      className="px-3 pt-1"
    />
  );
}

/**
 * Modo presentación: vista de solo lectura a pantalla completa para enseñar el proyecto al
 * cliente (Plano | Dashboard | Escenarios). Se pueden usar los dispositivos y simular, pero no
 * editar. Se sale con Esc o con el botón «Salir».
 */
export function PresentationView() {
  const name = useProjectStore((s) => s.project.name);
  const view = useViewStore((s) => s.presentationView);
  const setView = useViewStore((s) => s.setPresentationView);
  const running = useSimulationStore((s) => s.running);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || modalOpen()) return;
      // Primero se cierra el control abierto de un dispositivo.
      const ui = useUiStore.getState();
      if (ui.popoverDeviceId) {
        ui.openPopover(null);
        return;
      }
      exitPresentation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-800" data-testid="presentation">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <h1 className="flex min-w-0 items-center gap-2 text-base font-bold text-slate-900">
          <span aria-hidden="true">🏠</span>
          <span className="truncate">{name}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Presentación</span>
        </h1>
        <Tabs<View> label="Vista de la presentación" tabs={VIEWS} active={view} onChange={setView} idPrefix={PREFIX} className="mx-auto" />
        <div className="flex items-center gap-2">
          <SimulationControls />
          <Button size="sm" onClick={exitPresentation} title="Salir del modo presentación (Esc)">
            Salir <kbd className="ml-1 font-mono text-[10px] text-slate-600">Esc</kbd>
          </Button>
        </div>
      </header>
      <FailureBanner />
      {!running && view !== 'scenarios' && (
        <p className="bg-sky-50 px-3 py-1 text-center text-xs text-sky-900" role="status">
          Pulsa «Simular» para que corra el tiempo. Toca un dispositivo para encenderlo o apagarlo.
        </p>
      )}
      <main
        role="tabpanel"
        id={tabPanelId(PREFIX, view)}
        aria-labelledby={`${PREFIX}-tab-${view}`}
        className={cx('relative min-h-0 flex-1', view === 'scenarios' && 'overflow-auto')}
      >
        {view === 'plan' && (
          <div className="flex h-full flex-col">
            <FloorTabs />
            <div className="min-h-0 flex-1">
              <Canvas />
            </div>
          </div>
        )}
        {view === 'dashboard' && (
          <Suspense fallback={<p className="px-3 py-6 text-center text-sm text-slate-600">Cargando…</p>}>
            <DashboardView readOnly />
          </Suspense>
        )}
        {view === 'scenarios' && <PresentationScenarios />}
      </main>
    </div>
  );
}
