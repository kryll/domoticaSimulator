import { useSimulationStore } from '../store/simulationStore';
import { useLayoutStore } from '../store/layoutStore';
import { countLabel } from '../ui/plural';
import { useViewStore } from '../store/viewStore';
import { pendingPlanEvents } from './dayPlanActions';

/** Indicador «Día típico» en los controles de la simulación (abre el diálogo). */
export function DayPlanIndicator() {
  const pending = useSimulationStore((s) => pendingPlanEvents(s.sim.pending));
  const presentation = useViewStore((s) => s.presentation);
  if (pending === 0) {
    if (presentation) return null;
    return (
      <button
        type="button"
        onClick={() => useLayoutStore.getState().setDayPlanOpen(true)}
        aria-label="Generar día típico"
        title="Generar día típico: rutina de las personas de la casa"
        className="rounded-md px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <span aria-hidden="true">📅</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => useLayoutStore.getState().setDayPlanOpen(true)}
      title={`Día típico activo: ${countLabel(pending, 'evento pendiente', 'eventos pendientes')}`}
      className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      <span aria-hidden="true">📅</span> Día típico<span className="sr-only">: {countLabel(pending, 'evento pendiente', 'eventos pendientes')}</span>
    </button>
  );
}
