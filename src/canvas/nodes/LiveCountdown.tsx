import { useSimulationStore } from '../../store/simulationStore';
import { entityTimerKey, findTimer } from '../../simulation/engine';
import { clock } from './format';

/**
 * Cuenta atrás del temporizador interno de una entidad (autoapagado del movimiento...). Es el
 * único trozo del nodo que depende del reloj: solo se repinta él cuando cambia el segundo.
 */
export function LiveCountdown({ entityId, title }: { entityId: string; title: string }) {
  const seconds = useSimulationStore((s) => {
    const t = findTimer(s.sim, entityTimerKey(entityId));
    return t ? Math.max(0, Math.ceil((t.dueAt - s.sim.now) / 1000)) : undefined;
  });
  if (seconds === undefined) return null;
  return (
    <span className="rounded bg-orange-100 px-1 text-[10px] font-semibold tabular-nums text-orange-800" title={title}>
      ⏱ {clock(seconds)}
    </span>
  );
}
