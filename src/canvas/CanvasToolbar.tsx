import { Button } from '../ui/Button';
import { useUiStore, type CanvasMode } from '../store/uiStore';
import { autoConnect } from './actions';

const MODES: Array<{ mode: CanvasMode; label: string; hint: string }> = [
  { mode: 'select', label: 'Seleccionar', hint: 'Seleccionar y mover elementos' },
  { mode: 'room', label: 'Dibujar sala', hint: 'Dibujar una sala rectangular' },
  { mode: 'connect', label: 'Conectar', hint: 'Arrastra de un dispositivo a otro para conectarlos' },
];

export function CanvasToolbar() {
  const mode = useUiStore((s) => s.canvasMode);
  const setMode = useUiStore((s) => s.setCanvasMode);
  const showCoverage = useUiStore((s) => s.showCoverage);
  const toggleCoverage = useUiStore((s) => s.toggleCoverage);

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-white/95 p-1 shadow-sm" data-export-ignore="">
      <div role="group" aria-label="Modo del lienzo" className="flex gap-1">
        {MODES.map((m) => (
          <Button
            key={m.mode}
            size="sm"
            variant={mode === m.mode ? 'primary' : 'ghost'}
            aria-pressed={mode === m.mode}
            title={m.hint}
            onClick={() => setMode(m.mode)}
          >
            {m.label}
          </Button>
        ))}
      </div>
      <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
      <Button size="sm" variant="ghost" onClick={() => autoConnect()} title="Crear las conexiones sugeridas">
        Autoconectar
      </Button>
      <Button size="sm" variant={showCoverage ? 'primary' : 'ghost'} aria-pressed={showCoverage} onClick={toggleCoverage}>
        Cobertura
      </Button>
    </div>
  );
}
