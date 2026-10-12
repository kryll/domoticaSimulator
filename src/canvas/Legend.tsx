import { useId } from 'react';
import { PROTOCOL_LABELS } from '../devices/catalog';
import type { Protocol } from '../types';
import { useViewStore } from '../store/viewStore';
import { PROTOCOL_COLORS } from './style';

/** Leyenda de colores por protocolo, plegable (se recuerda en el navegador). */
export function Legend({ protocols }: { protocols?: Protocol[] }) {
  const list = protocols ?? (Object.keys(PROTOCOL_COLORS) as Protocol[]);
  const open = useViewStore((s) => s.showLegend);
  const setOpen = useViewStore((s) => s.setShowLegend);
  const id = useId();
  return (
    <div className="rounded-md border border-slate-200 bg-white/95 text-[11px] shadow-sm" role="group" aria-label="Leyenda de protocolos">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        title={open ? 'Plegar la leyenda' : 'Mostrar la leyenda'}
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
      >
        Protocolos <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul id={id} className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-2 pb-2">
          {list.map((p) => (
            <li key={p} className="flex items-center gap-1.5 text-slate-700">
              <span className="inline-block h-0.5 w-4" style={{ backgroundColor: PROTOCOL_COLORS[p] }} aria-hidden="true" />
              {PROTOCOL_LABELS[p]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
