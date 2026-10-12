import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useSimulationStore } from '../store/simulationStore';
import { formatSimTime } from '../simulation/clock';
import { isTimer } from '../simulation/engine';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/Panel';
import { cx } from '../ui/cx';
import { AutomationEditor } from './AutomationEditor';

/** Lista de automatizaciones del proyecto con su editor. */
export function AutomationsPanel() {
  const automations = useProjectStore((s) => s.project.automations);
  const addAutomation = useProjectStore((s) => s.addAutomation);
  const updateAutomation = useProjectStore((s) => s.updateAutomation);
  const removeAutomation = useProjectStore((s) => s.removeAutomation);
  const selectedId = useUiStore((s) => s.selectedAutomationId);
  const selectAutomation = useUiStore((s) => s.selectAutomation);
  const selected = automations.find((a) => a.id === selectedId) ?? automations[0];
  const runAutomation = useSimulationStore((s) => s.runAutomation);
  const running = useSimulationStore((s) => s.running);
  const pending = useSimulationStore((s) => s.sim.pending);
  const notify = useUiStore((s) => s.notify);
  const waits = selected ? pending.filter((p) => !isTimer(p) && p.automationId === selected.id) : [];
  const nextDue = waits.reduce<number | undefined>((min, p) => (min === undefined || p.dueAt < min ? p.dueAt : min), undefined);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-60 shrink-0 flex-col border-r border-slate-200">
        <div className="p-2">
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={() => selectAutomation(addAutomation().id)}
          >
            + Nueva automatización
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto" aria-label="Automatizaciones">
          {automations.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => selectAutomation(a.id)}
                aria-current={selected?.id === a.id ? 'true' : undefined}
                className={cx(
                  'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500',
                  selected?.id === a.id ? 'bg-sky-50 font-medium text-sky-800' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className="truncate">{a.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {pending.some((p) => !isTimer(p) && p.automationId === a.id) && (
                    <span title="Tiene esperas pendientes" aria-label="Tiene esperas pendientes">
                      ⏳
                    </span>
                  )}
                  {!a.enabled && <Badge>Apagada</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-auto p-3">
        {selected ? (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
              {waits.length > 0 && (
                <p
                  className={cx(
                    'mr-auto rounded-md px-2 py-1 text-xs',
                    running ? 'bg-sky-50 text-sky-800' : 'bg-amber-50 text-amber-900',
                  )}
                  role="status"
                >
                  ⏳ {waits.length === 1 ? '1 espera pendiente' : `${waits.length} esperas pendientes`}
                  {nextDue !== undefined && <> (siguiente a las {formatSimTime(nextDue, { seconds: true })})</>}
                  {!running && ' · la simulación está en pausa: pulsa Simular para que avancen'}
                </p>
              )}
              <Button
                size="sm"
                variant="primary"
                title="Ejecuta las acciones ahora, sin comprobar las condiciones"
                onClick={() => {
                  runAutomation(selected.id, true);
                  notify(`Ejecutada «${selected.name}»${running ? '' : '. La simulación está en pausa: las esperas no avanzarán'}`, 'success');
                }}
              >
                ▶ Ejecutar ahora
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (window.confirm(`¿Eliminar la automatización "${selected.name}"?`)) {
                    removeAutomation(selected.id);
                    selectAutomation(null);
                  }
                }}
              >
                Eliminar
              </Button>
            </div>
            <AutomationEditor
              key={selected.id}
              automation={selected}
              onChange={(a) => updateAutomation(selected.id, a)}
            />
          </>
        ) : (
          <EmptyState>No hay automatizaciones. Crea una para empezar.</EmptyState>
        )}
      </div>
    </div>
  );
}
