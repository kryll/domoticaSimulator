import { useSimulationStore, SPEEDS, type Speed } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { SimClock } from './SimClock';
import { userWaits } from './engine';
import { Button } from '../ui/Button';
import { confirmDialog } from '../ui/confirm';

/** Controles de la simulación: reproducir/pausar, reiniciar, velocidad y reloj. */
export function SimulationControls() {
  const running = useSimulationStore((s) => s.running);
  const speed = useSimulationStore((s) => s.speed);
  const start = useSimulationStore((s) => s.start);
  const pause = useSimulationStore((s) => s.pause);
  const reset = useSimulationStore((s) => s.reset);
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const waits = useSimulationStore((s) => userWaits(s.sim).length);

  const onStart = () => {
    start();
    const ui = useUiStore.getState();
    if (ui.canvasMode !== 'interact' && ui.canvasMode !== 'room' && !ui.interactOffered) {
      ui.setInteractOffered(true);
      ui.notify('Simulación en marcha. ¿Quieres controlar los dispositivos con un clic?', 'info', {
        action: { label: 'Activar modo Uso (U)', run: () => useUiStore.getState().setCanvasMode('interact') },
      });
    }
  };

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Simulación">
      {running ? (
        <Button size="sm" onClick={pause} aria-label="Pausar simulación" title="Pausar (P)">
          ⏸ Pausar
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={onStart} aria-label="Iniciar simulación" title="Iniciar (P)">
          ▶ Simular
        </Button>
      )}
      {!running && waits > 0 && (
        <span
          className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
          title="Hay acciones con espera (delay) pendientes que no avanzan mientras la simulación está en pausa"
        >
          ⏳ {waits} en espera
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          const ok = await confirmDialog({
            title: '¿Reiniciar la simulación?',
            message: 'Se perderán los estados y el registro.',
            confirmLabel: 'Reiniciar',
            danger: true,
          });
          if (ok) reset();
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
      <SimClock />
    </div>
  );
}
