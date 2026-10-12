import { Button } from '../ui/Button';
import { useUiStore, type CanvasMode } from '../store/uiStore';
import { autoConnect } from './actions';
import { CanvasLayerToggles } from './extras/CanvasLayerToggles';

const MODES: Array<{ mode: CanvasMode; label: string; hint: string; key: string }> = [
  { mode: 'select', label: 'Edición', hint: 'Seleccionar y mover elementos (V). Alt+clic o ⏻ = acción principal', key: 'V' },
  { mode: 'interact', label: 'Uso', hint: 'Usar los dispositivos: clic = acción principal, rueda = ajustar (U)', key: 'U' },
  { mode: 'room', label: 'Dibujar sala', hint: 'Dibujar una sala rectangular (R)', key: 'R' },
  { mode: 'connect', label: 'Conectar', hint: 'Arrastra de un dispositivo a otro para conectarlos (C)', key: 'C' },
  { mode: 'wall', label: 'Dibujar pared', hint: 'Dibujar paredes sobre el plano (atenúan la señal)', key: '' },
];

export function CanvasToolbar() {
  const mode = useUiStore((s) => s.canvasMode);
  const setMode = useUiStore((s) => s.setCanvasMode);
  const showCoverage = useUiStore((s) => s.showCoverage);
  const toggleCoverage = useUiStore((s) => s.toggleCoverage);
  const openHelp = useUiStore((s) => s.setShortcutsOpen);

  return (
    <div className="flex flex-col items-start gap-1" data-export-ignore="">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-white/95 p-1 shadow-sm">
        <div role="group" aria-label="Modo del lienzo" className="flex gap-1">
          {MODES.map((m) => (
            <Button
              key={m.mode}
              size="sm"
              variant={mode === m.mode ? 'primary' : 'ghost'}
              aria-pressed={mode === m.mode}
              aria-keyshortcuts={m.key || undefined}
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
        <CanvasLayerToggles />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => openHelp(true)}
          aria-label="Atajos de teclado"
          title="Atajos de teclado (?)"
          aria-keyshortcuts="?"
        >
          ?
        </Button>
      </div>
      {mode === 'interact' && (
        <p className="rounded-md bg-emerald-600/95 px-2 py-1 text-xs font-medium text-white shadow" role="status">
          Modo Uso: clic = acción principal · doble clic = control · Mayús+clic selecciona · rueda ajusta
        </p>
      )}
    </div>
  );
}
