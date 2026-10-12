import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { useUiStore } from '../store/uiStore';
import { useExtrasStore } from '../store/extrasStore';
import { useProjectStore } from '../store/projectStore';
import { autoConnect } from './actions';
import { toggleRouterSuggestion } from './extras/routerSuggestion';
import { useViewStore, type ConnectionsLayer } from '../store/viewStore';

const CONNECTION_LAYERS: Array<[ConnectionsLayer, string]> = [
  ['all', 'Todas'],
  ['selected', 'Solo del seleccionado'],
  ['none', 'Ninguna'],
];

/** Altura reservada por la barra del lienzo (px): el encuadre deja este margen arriba. */
export const CANVAS_TOOLBAR_PX = 52;

/**
 * Barra del lienzo en una sola fila: modos (Edición, Uso, Dibujar ▾, Conectar), Capas ▾,
 * Herramientas ▾ y ayuda.
 */
export function CanvasToolbar() {
  const mode = useUiStore((s) => s.canvasMode);
  const setMode = useUiStore((s) => s.setCanvasMode);
  const showCoverage = useUiStore((s) => s.showCoverage);
  const toggleCoverage = useUiStore((s) => s.toggleCoverage);
  const openHelp = useUiStore((s) => s.setShortcutsOpen);
  const showClimate = useExtrasStore((s) => s.showClimate);
  const showSignal = useExtrasStore((s) => s.showSignal);
  const suggestion = useExtrasStore((s) => s.routerSuggestion);
  const activeFloorId = useUiStore((s) => s.activeFloorId);
  const firstFloor = useProjectStore((s) => s.project.floors[0]?.id);
  const floorId = activeFloorId ?? firstFloor;
  const drawing = mode === 'room' || mode === 'wall';
  const connectionsLayer = useViewStore((s) => s.connectionsLayer);
  const layers = [showCoverage, showClimate, showSignal, connectionsLayer !== 'all'].filter(Boolean).length;

  const modeButton = (m: 'select' | 'interact' | 'connect', label: string, hint: string, key: string) => (
    <Button
      size="sm"
      variant={mode === m ? 'primary' : 'ghost'}
      aria-pressed={mode === m}
      aria-keyshortcuts={key}
      title={hint}
      onClick={() => setMode(m)}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col items-start gap-1" data-export-ignore="">
      <div className="flex flex-nowrap items-center gap-1 rounded-md border border-slate-200 bg-white/95 p-1 shadow-sm">
        <div role="group" aria-label="Modo del lienzo" className="flex items-center gap-1">
          {modeButton('select', 'Edición', 'Seleccionar y mover elementos (V). Alt+clic o ⏻ = acción principal', 'V')}
          {modeButton('interact', 'Uso', 'Usar los dispositivos: clic = acción principal, rueda = ajustar (U)', 'U')}
          <Dropdown
            label={mode === 'wall' ? 'Dibujar pared' : mode === 'room' ? 'Dibujar sala' : 'Dibujar'}
            ariaLabel="Dibujar"
            active={drawing}
            title="Dibujar salas (R) o paredes"
            entries={[
              { kind: 'item', id: 'room', role: 'menuitemradio', checked: mode === 'room', label: 'Dibujar sala', hint: 'R', onSelect: () => setMode('room') },
              { kind: 'item', id: 'wall', role: 'menuitemradio', checked: mode === 'wall', label: 'Dibujar pared', onSelect: () => setMode('wall') },
            ]}
          />
          {modeButton('connect', 'Conectar', 'Arrastra de un dispositivo a otro para conectarlos (C)', 'C')}
        </div>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
        <Dropdown
          label={layers > 0 ? `Capas (${layers})` : 'Capas'}
          ariaLabel="Capas"
          active={layers > 0}
          entries={[
            { kind: 'item', id: 'coverage', label: 'Cobertura', checked: showCoverage, keepOpen: true, onSelect: toggleCoverage },
            { kind: 'item', id: 'climate', label: 'Clima', title: 'Temperatura de cada sala', checked: showClimate, keepOpen: true, onSelect: () => useExtrasStore.getState().toggleClimate() },
            { kind: 'item', id: 'signal', label: 'Señal', title: 'Mapa de calor de la señal (RSSI)', checked: showSignal, keepOpen: true, onSelect: () => useExtrasStore.getState().toggleSignal() },
            { kind: 'separator', id: 'sep-conn' },
            { kind: 'header', id: 'conn', label: 'Conexiones' },
            ...CONNECTION_LAYERS.map(([value, label]) => ({
              kind: 'item' as const,
              id: `conn-${value}`,
              role: 'menuitemradio' as const,
              label,
              title: `Conexiones: ${label.toLowerCase()}`,
              checked: connectionsLayer === value,
              keepOpen: true,
              onSelect: () => useViewStore.getState().setConnectionsLayer(value),
            })),
          ]}
        />
        <Dropdown
          label="Herramientas"
          entries={[
            { kind: 'item', id: 'autoconnect', label: 'Autoconectar', title: 'Crear las conexiones sugeridas', onSelect: () => autoConnect() },
            {
              kind: 'item',
              id: 'router',
              label: 'Sugerir router',
              title: 'Propone dónde poner un router Zigbee, Thread o Z-Wave',
              checked: suggestion !== null && suggestion.floorId === floorId,
              onSelect: () => toggleRouterSuggestion(floorId),
            },
          ]}
        />
        <Dropdown
          label="?"
          ariaLabel="Ayuda"
          title="Ayuda: visita guiada y atajos de teclado (?)"
          align="right"
          entries={[
            { kind: 'item', id: 'tour', label: 'Visita guiada (5 pasos)', onSelect: () => useViewStore.getState().startTour() },
            { kind: 'item', id: 'shortcuts', label: 'Atajos de teclado', hint: '?', onSelect: () => openHelp(true) },
          ]}
        />
      </div>
      {mode === 'interact' && (
        <p className="rounded-md bg-emerald-800/95 px-2 py-1 text-xs font-medium text-white shadow" role="status">
          Modo Uso: clic = acción principal · doble clic = control · Mayús+clic selecciona · rueda ajusta
        </p>
      )}
    </div>
  );
}
