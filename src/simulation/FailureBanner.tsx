import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { useViewStore } from '../store/viewStore';
import { NO_FAILURES, failureLabels, hasFailures } from '../ui/failures';
import { Button } from '../ui/Button';

/** Banda visible mientras hay fallos simulados activos («Sin Internet», «Corte de luz»...). */
export function FailureBanner() {
  const failures = useSimulationStore((s) => s.sim.failures);
  const devices = useProjectStore((s) => s.project.devices);
  if (!hasFailures(failures)) return null;
  const labels = failureLabels(failures, (id) => devices.find((d) => d.id === id)?.name ?? id);
  const tone = failures?.powerOutage || failures?.haRestarting ? 'bg-red-700' : 'bg-amber-800';
  return (
    <div className={`flex flex-wrap items-center gap-2 px-3 py-1 text-sm font-medium text-white ${tone}`} role="status" aria-label="Modo fallo">
      <span aria-hidden="true">⚠</span>
      <span className="font-semibold">Modo fallo:</span>
      <span className="min-w-0 flex-1 truncate" data-testid="failure-banner-text">
        {labels.join(' · ')}
      </span>
      <Button size="sm" variant="ghost" className="!text-white hover:!bg-white/20" onClick={() => (useViewStore.getState().presentation ? useViewStore.getState().setPresentationView('scenarios') : useUiStore.getState().setBottomTab('impact'))}>
        Ver impacto
      </Button>
      <Button size="sm" className="!border-white/60 !bg-white/10 !text-white hover:!bg-white/25" onClick={() => useSimulationStore.getState().setFailures(NO_FAILURES)}>
        Restaurar todo
      </Button>
    </div>
  );
}
