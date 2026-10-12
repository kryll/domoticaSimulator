// Lienzo legible: minimapa plegable, capa «Conexiones» y zoom semántico (clase CSS según el zoom,
// sin reconstruir los nodos).
import { useEffect } from 'react';
import { Panel as FlowPanel, useReactFlow, useStore, type FitViewOptions, type ReactFlowState } from '@xyflow/react';
import { COMPACT_CLASS, isCompactZoom } from './zoomLevel';
import { useViewStore } from '../store/viewStore';

const compactSelector = (s: ReactFlowState) => isCompactZoom(s.transform[2]);

/**
 * Pone o quita la clase de zoom compacto en el contenedor del lienzo. Solo se vuelve a pintar
 * cuando se cruza el umbral (el selector devuelve un booleano) y no toca los nodos.
 */
export function ZoomLevelClass({ containerId }: { containerId: string }) {
  const compact = useStore(compactSelector);
  useEffect(() => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.toggle(COMPACT_CLASS, compact);
    el.dataset.zoom = compact ? 'compact' : 'full';
  }, [compact, containerId]);
  return null;
}

/** Botón para plegar o mostrar el minimapa (se recuerda). */
export function MinimapToggle() {
  const show = useViewStore((s) => s.showMinimap);
  const setShow = useViewStore((s) => s.setShowMinimap);
  return (
    <FlowPanel position="bottom-right" className={show ? '!mb-[164px] !mr-[15px] hidden md:block' : 'hidden md:block'}>
      <button
        type="button"
        data-export-ignore=""
        aria-pressed={show}
        onClick={() => setShow(!show)}
        title={show ? 'Ocultar el minimapa' : 'Mostrar el minimapa'}
        className="rounded-md border border-slate-300 bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
      >
        Minimapa {show ? '▾' : '▸'}
      </button>
    </FlowPanel>
  );
}

const zoomLimits = (s: ReactFlowState) => `${s.transform[2] <= s.minZoom ? 'min' : ''}|${s.transform[2] >= s.maxZoom ? 'max' : ''}`;

const CONTROL_BUTTON =
  'flex h-7 w-7 items-center justify-center border-b border-slate-200 bg-white text-base font-semibold text-slate-700 last:border-b-0 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-600 disabled:text-slate-400';

/** Controles de zoom propios (en español y con rol de barra de herramientas). */
export function CanvasControls({ fitViewOptions }: { fitViewOptions?: FitViewOptions }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const limits = useStore(zoomLimits);
  return (
    <FlowPanel position="bottom-left">
      <div role="toolbar" aria-label="Zoom del lienzo" aria-orientation="vertical" className="flex flex-col overflow-hidden rounded-md border border-slate-300 shadow-sm" data-export-ignore="">
        <button type="button" className={CONTROL_BUTTON} aria-label="Acercar" title="Acercar" disabled={limits.endsWith('max')} onClick={() => void zoomIn({ duration: 150 })}>
          +
        </button>
        <button type="button" className={CONTROL_BUTTON} aria-label="Alejar" title="Alejar" disabled={limits.startsWith('min')} onClick={() => void zoomOut({ duration: 150 })}>
          −
        </button>
        <button type="button" className={CONTROL_BUTTON} aria-label="Encuadrar todo" title="Encuadrar todo" onClick={() => void fitView({ ...fitViewOptions, duration: 200 })}>
          <span aria-hidden="true">⤢</span>
        </button>
      </div>
    </FlowPanel>
  );
}
