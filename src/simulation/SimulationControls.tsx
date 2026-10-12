import { useSimulationStore, SPEEDS, type Speed } from '../store/simulationStore';
import { formatSimDate, formatSimTime } from './clock';
import { Button } from '../ui/Button';

/** Controles de la simulación: reproducir/pausar, reiniciar, velocidad y reloj. */
export function SimulationControls() {
  const running = useSimulationStore((s) => s.running);
  const speed = useSimulationStore((s) => s.speed);
  const now = useSimulationStore((s) => s.sim.now);
  const start = useSimulationStore((s) => s.start);
  const pause = useSimulationStore((s) => s.pause);
  const reset = useSimulationStore((s) => s.reset);
  const setSpeed = useSimulationStore((s) => s.setSpeed);

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Simulación">
      {running ? (
        <Button size="sm" onClick={pause} aria-label="Pausar simulación" title="Pausar">
          ⏸ Pausar
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={start} aria-label="Iniciar simulación" title="Iniciar">
          ▶ Simular
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (window.confirm('¿Reiniciar la simulación? Se perderán los estados y el logbook.')) reset();
        }}
        aria-label="Reiniciar simulación"
        title="Reiniciar"
      >
        ⟲
      </Button>
      <label className="sr-only" htmlFor="sim-speed">
        Velocidad
      </label>
      <select
        id="sim-speed"
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
        className="rounded-md border border-slate-300 bg-white px-1 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
      <div
        className="ml-1 flex flex-col items-end rounded-md bg-slate-800 px-2 py-0.5 font-mono leading-tight text-white"
        aria-label="Hora simulada"
        aria-live="off"
      >
        <span className="text-sm">{formatSimTime(now, { seconds: true })}</span>
        <span className="text-[10px] text-slate-300">{formatSimDate(now)}</span>
      </div>
    </div>
  );
}
