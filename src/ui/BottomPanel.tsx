import { lazy, Suspense, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { BOTTOM_MIN, useUiStore, type BottomTab } from '../store/uiStore';
import { analyzeProject } from '../canvas/analysis';
import { ValidationPanel } from '../simulation/ValidationPanel';
import { LogbookPanel } from '../simulation/LogbookPanel';
import { Tabs } from './Tabs';
import { Button } from './Button';
import { tabPanelId } from './ids';
import { hasFailures } from './failures';

const PREFIX = 'bottom';

// Paneles pesados cargados bajo demanda para aligerar el bundle inicial.
const AutomationsPanel = lazy(() => import('../automations/AutomationsPanel').then((m) => ({ default: m.AutomationsPanel })));
const ScenesPanel = lazy(() => import('../scenes/ScenesPanel').then((m) => ({ default: m.ScenesPanel })));
const ImpactPanel = lazy(() => import('../reports/ImpactPanel').then((m) => ({ default: m.ImpactPanel })));
const BudgetPanel = lazy(() => import('../reports/BudgetPanel').then((m) => ({ default: m.BudgetPanel })));
const EnergyPanel = lazy(() => import('../reports/EnergyPanel').then((m) => ({ default: m.EnergyPanel })));

function Loading() {
  return <p className="px-3 py-6 text-center text-sm text-slate-500">Cargando…</p>;
}

function Count({ n, tone }: { n: number; tone: 'red' | 'slate' }) {
  if (n === 0) return null;
  return (
    <span
      className={
        tone === 'red'
          ? 'ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white'
          : 'ml-1 rounded-full bg-slate-200 px-1.5 text-[10px] font-bold text-slate-700'
      }
    >
      {n}
    </span>
  );
}

/** Asa para cambiar la altura del panel arrastrando o con las flechas. */
function ResizeHandle() {
  const height = useUiStore((s) => s.bottomHeight);
  const setHeight = useUiStore((s) => s.setBottomHeight);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const max = typeof window === 'undefined' ? 800 : Math.max(BOTTOM_MIN, window.innerHeight - 160);
  const clamp = (h: number) => Math.min(max, Math.max(BOTTOM_MIN, h));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { y: e.clientY, h: height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setHeight(clamp(drag.current.h + (drag.current.y - e.clientY)));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') setHeight(clamp(height + 40));
    else if (e.key === 'ArrowDown') setHeight(clamp(height - 40));
    else return;
    e.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Cambiar la altura del panel inferior"
      aria-valuemin={BOTTOM_MIN}
      aria-valuemax={max}
      aria-valuenow={height}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className="group flex h-2 cursor-row-resize touch-none items-center justify-center focus:outline-none focus-visible:bg-sky-100"
    >
      <span className="h-1 w-12 rounded-full bg-slate-300 group-hover:bg-sky-400" aria-hidden="true" />
    </div>
  );
}

/** Panel inferior plegable y redimensionable con validación, automatizaciones, escenas y logbook. */
export function BottomPanel() {
  const tab = useUiStore((s) => s.bottomTab);
  const open = useUiStore((s) => s.bottomOpen);
  const height = useUiStore((s) => s.bottomHeight);
  const maximized = useUiStore((s) => s.bottomMaximized);
  const setTab = useUiStore((s) => s.setBottomTab);
  const setOpen = useUiStore((s) => s.setBottomOpen);
  const setMaximized = useUiStore((s) => s.setBottomMaximized);
  const project = useProjectStore((s) => s.project);
  const logCount = useSimulationStore((s) => s.sim.log.length);
  const failing = useSimulationStore((s) => hasFailures(s.sim.failures));
  const issues = analyzeProject(project).issues;
  const problems = issues.filter((i) => i.severity !== 'info').length;

  const tabs: Array<{ key: BottomTab; label: ReactNode }> = [
    { key: 'validation', label: <>Validación<Count n={problems} tone="red" /></> },
    {
      key: 'impact',
      label: (
        <>
          Impacto
          {failing && (
            <span className="ml-1 inline-block h-2 w-2 rounded-full bg-red-600 align-middle" role="img" aria-label="(fallos activos)" />
          )}
        </>
      ),
    },
    { key: 'automations', label: <>Automatizaciones<Count n={project.automations.length} tone="slate" /></> },
    { key: 'scenes', label: <>Escenas y scripts<Count n={project.scenes.length + project.scripts.length} tone="slate" /></> },
    { key: 'budget', label: 'Presupuesto' },
    { key: 'energy', label: 'Energía' },
    { key: 'logbook', label: <>Registro<Count n={logCount} tone="slate" /></> },
  ];

  return (
    <section
      className={
        maximized
          ? 'absolute inset-0 z-30 flex min-h-0 flex-col bg-white'
          : 'flex min-h-0 shrink-0 flex-col border-t border-slate-200 bg-white'
      }
      style={open && !maximized ? { height } : undefined}
      aria-label="Panel inferior"
    >
      {open && !maximized && <ResizeHandle />}
      <div className="flex items-center justify-between px-2 pt-1">
        <Tabs<BottomTab> label="Herramientas" tabs={tabs} active={tab} onChange={setTab} idPrefix={PREFIX} />
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMaximized(!maximized)}
            aria-pressed={maximized}
            aria-label={maximized ? 'Restaurar panel inferior' : 'Maximizar panel inferior'}
            title={maximized ? 'Restaurar' : 'Pantalla completa'}
          >
            {maximized ? '🗗' : '⛶'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? 'Plegar panel inferior' : 'Desplegar panel inferior'}
          >
            {open ? '▾' : '▴'}
          </Button>
        </div>
      </div>
      {open && (
        <div
          role="tabpanel"
          id={tabPanelId(PREFIX, tab)}
          aria-labelledby={`${PREFIX}-tab-${tab}`}
          className="min-h-0 flex-1 overflow-auto border-t border-slate-200"
        >
          {tab === 'validation' && <ValidationPanel issues={issues} />}
          <Suspense fallback={<Loading />}>
            {tab === 'automations' && <AutomationsPanel />}
            {tab === 'scenes' && <ScenesPanel />}
            {tab === 'impact' && <ImpactPanel />}
            {tab === 'budget' && <BudgetPanel />}
            {tab === 'energy' && <EnergyPanel />}
          </Suspense>
          {tab === 'logbook' && <LogbookPanel />}
        </div>
      )}
    </section>
  );
}
