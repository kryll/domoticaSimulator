import type { ReactNode } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore, type BottomTab } from '../store/uiStore';
import { analyzeProject } from '../canvas/analysis';
import { ValidationPanel } from '../simulation/ValidationPanel';
import { LogbookPanel } from '../simulation/LogbookPanel';
import { AutomationsPanel } from '../automations/AutomationsPanel';
import { ScenesPanel } from '../scenes/ScenesPanel';
import { Tabs } from './Tabs';
import { Button } from './Button';
import { tabPanelId } from './ids';

const PREFIX = 'bottom';

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

/** Panel inferior plegable con validación, automatizaciones, escenas y logbook. */
export function BottomPanel() {
  const tab = useUiStore((s) => s.bottomTab);
  const open = useUiStore((s) => s.bottomOpen);
  const setTab = useUiStore((s) => s.setBottomTab);
  const setOpen = useUiStore((s) => s.setBottomOpen);
  const project = useProjectStore((s) => s.project);
  const logCount = useSimulationStore((s) => s.sim.log.length);
  const issues = analyzeProject(project).issues;
  const problems = issues.filter((i) => i.severity !== 'info').length;

  const tabs: Array<{ key: BottomTab; label: ReactNode }> = [
    { key: 'validation', label: <>Validación<Count n={problems} tone="red" /></> },
    { key: 'automations', label: <>Automatizaciones<Count n={project.automations.length} tone="slate" /></> },
    { key: 'scenes', label: <>Escenas y scripts<Count n={project.scenes.length + project.scripts.length} tone="slate" /></> },
    { key: 'logbook', label: <>Logbook<Count n={logCount} tone="slate" /></> },
  ];

  return (
    <section
      className={open ? 'flex h-72 min-h-0 flex-col border-t border-slate-200 bg-white' : 'flex flex-col border-t border-slate-200 bg-white'}
      aria-label="Panel inferior"
    >
      <div className="flex items-center justify-between px-2 pt-1">
        <Tabs<BottomTab> label="Herramientas" tabs={tabs} active={tab} onChange={setTab} idPrefix={PREFIX} />
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
      {open && (
        <div
          role="tabpanel"
          id={tabPanelId(PREFIX, tab)}
          aria-labelledby={`${PREFIX}-tab-${tab}`}
          className="min-h-0 flex-1 overflow-auto border-t border-slate-200"
        >
          {tab === 'validation' && <ValidationPanel issues={issues} />}
          {tab === 'automations' && <AutomationsPanel />}
          {tab === 'scenes' && <ScenesPanel />}
          {tab === 'logbook' && <LogbookPanel />}
        </div>
      )}
    </section>
  );
}
