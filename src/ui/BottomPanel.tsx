import { lazy, Suspense, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { BOTTOM_MIN, useUiStore, type BottomTab } from '../store/uiStore';
import { analyzeProject } from '../canvas/analysis';
import { ValidationPanel } from '../simulation/ValidationPanel';
import { LogbookPanel } from '../simulation/LogbookPanel';
import { OverflowTabs } from './OverflowTabs';
import { Button } from './Button';
import { tabPanelId } from './ids';
import { EXTRA_TABS, TAB_GROUPS, groupOfTab, type TabGroup } from './extraTabs';
import { cx } from './cx';
import { ExtraTabPanel } from './ExtraTabPanel';
import { hasFailures } from './failures';
import { useAutomationsWorkspaceOpen, useViewStore } from '../store/viewStore';
import { useIsTabletUp } from './breakpoints';

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

/** Marcador del panel inferior mientras el editor de automatizaciones está abierto en grande. */
function AutomationsInWorkspace() {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-slate-600">
      <p>El editor de automatizaciones está abierto en grande.</p>
      <Button size="sm" onClick={() => useViewStore.getState().setAutomationsModal(true)}>
        Volver al editor
      </Button>
    </div>
  );
}

/** Panel inferior plegable y redimensionable con validación, automatizaciones, escenas y logbook. */
export function BottomPanel() {
  const tab = useUiStore((s) => s.bottomTab);
  const open = useUiStore((s) => s.bottomOpen);
  const height = useUiStore((s) => s.bottomHeight);
  const maximizedPref = useUiStore((s) => s.bottomMaximized);
  // En el móvil (< 768 px), abierto ocupa toda la pantalla.
  const tabletUp = useIsTabletUp();
  const maximized = maximizedPref || (!tabletUp && open);
  const setTab = useUiStore((s) => s.setBottomTab);
  const setOpen = useUiStore((s) => s.setBottomOpen);
  const setMaximized = useUiStore((s) => s.setBottomMaximized);
  const project = useProjectStore((s) => s.project);
  const automationsModal = useAutomationsWorkspaceOpen();
  const logCount = useSimulationStore((s) => s.sim.log.length);
  const failing = useSimulationStore((s) => hasFailures(s.sim.failures));
  const issues = analyzeProject(project).issues;
  const problems = issues.filter((i) => i.severity !== 'info').length;

  const allTabs: Array<{ key: BottomTab; label: ReactNode; text: string }> = [
    { key: 'validation', text: 'Validación', label: <>Validación<Count n={problems} tone="red" /></> },
    {
      key: 'impact',
      text: 'Impacto',
      label: (
        <>
          Impacto
          {failing && (
            <span className="ml-1 inline-block h-2 w-2 rounded-full bg-red-600 align-middle" role="img" aria-label="(fallos activos)" />
          )}
        </>
      ),
    },
    { key: 'automations', text: 'Automatizaciones', label: <>Automatizaciones<Count n={project.automations.length} tone="slate" /></> },
    { key: 'scenes', text: 'Escenas y scripts', label: <>Escenas y scripts<Count n={project.scenes.length + project.scripts.length} tone="slate" /></> },
    { key: 'budget', text: 'Presupuesto', label: 'Presupuesto' },
    { key: 'energy', text: 'Energía', label: 'Energía' },
    { key: 'logbook', text: 'Registro', label: <>Registro<Count n={logCount} tone="slate" /></> },
    ...EXTRA_TABS.map((t) => ({ ...t, text: t.label })),
  ];
  const group = groupOfTab(tab);
  const tabs = TAB_GROUPS.find((g) => g.key === group)?.tabs.map((k) => allTabs.find((t) => t.key === k)).filter((t): t is (typeof allTabs)[number] => t !== undefined) ?? [];
  const groupAlert: Record<TabGroup, boolean> = { design: problems > 0 || failing, logic: false, use: false };
  // Última pestaña abierta de cada grupo, para volver a ella al cambiar de grupo.
  const lastTab = useRef<Partial<Record<TabGroup, BottomTab>>>({});
  lastTab.current[group] = tab;

  return (
    <section
      className={
        maximized
          ? cx('flex min-h-0 flex-col bg-white', tabletUp ? 'absolute inset-0 z-30' : 'fixed inset-0 z-30')
          : 'flex min-h-0 shrink-0 flex-col border-t border-slate-200 bg-white'
      }
      style={open && !maximized ? { height } : undefined}
      aria-label="Panel inferior"
      id="panel-inferior"
      data-tour="bottom"
      tabIndex={-1}
    >
      {open && !maximized && <ResizeHandle />}
      <div className="flex items-center justify-between gap-2 px-2 pt-1">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div role="group" aria-label="Grupo de herramientas" className="flex shrink-0 rounded-md bg-slate-100 p-0.5">
            {TAB_GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                aria-pressed={g.key === group}
                aria-label={`${g.label}: grupo de pestañas${groupAlert[g.key] && g.key !== group ? ' (hay avisos)' : ''}`}
                onClick={() => setTab(lastTab.current[g.key] ?? g.tabs[0] ?? 'validation')}
                className={cx(
                  'relative rounded px-2.5 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                  g.key === group ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {g.label}
                {groupAlert[g.key] && g.key !== group && (
                  <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-600" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
          <OverflowTabs<BottomTab> label="Herramientas" tabs={tabs} active={tab} onChange={setTab} idPrefix={PREFIX} />
        </div>
        <div className="flex items-center gap-1">
          {tabletUp && <Button
            size="sm"
            variant="ghost"
            onClick={() => setMaximized(!maximized)}
            aria-pressed={maximized}
            aria-label={maximized ? 'Restaurar panel inferior' : 'Maximizar panel inferior'}
            title={maximized ? 'Restaurar' : 'Pantalla completa'}
          >
            {maximized ? '🗗' : '⛶'}
          </Button>}
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
      {/* El panel siempre existe (aria-controls de la pestaña activa apunta a él); plegado, vacío y oculto. */}
      <div
        role="tabpanel"
        id={tabPanelId(PREFIX, tab)}
        aria-labelledby={`${PREFIX}-tab-${tab}`}
        hidden={!open}
        className="min-h-0 flex-1 overflow-auto border-t border-slate-200"
      >
        {open && (
        <>
          {tab === 'validation' && <ValidationPanel issues={issues} />}
          <Suspense fallback={<Loading />}>
            {tab === 'automations' && (automationsModal ? <AutomationsInWorkspace /> : <AutomationsPanel />)}
            {tab === 'scenes' && <ScenesPanel />}
            {tab === 'impact' && <ImpactPanel />}
            {tab === 'budget' && <BudgetPanel />}
            {tab === 'energy' && <EnergyPanel />}
          </Suspense>
          {tab === 'logbook' && <LogbookPanel />}
          <ExtraTabPanel tab={tab} />
        </>
        )}
      </div>
    </section>
  );
}
