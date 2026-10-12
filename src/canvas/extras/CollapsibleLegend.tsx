import { useId, type ReactNode } from 'react';
import { useViewStore } from '../../store/viewStore';

/** Leyendas de las capas, plegables para no tapar nodos (se recuerda en el navegador). */
export function CollapsibleLegend({ children }: { children: ReactNode }) {
  const open = useViewStore((s) => s.showLayerLegend);
  const setOpen = (fn: (o: boolean) => boolean) => useViewStore.getState().setShowLayerLegend(fn(open));
  const id = useId();
  return (
    <div className="flex flex-col items-end gap-1" data-export-ignore="">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-slate-200 bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        title={open ? 'Plegar la leyenda' : 'Mostrar la leyenda'}
      >
        Leyenda {open ? '▾' : '▸'}
      </button>
      {open && (
        <div id={id} className="flex flex-col items-end gap-1">
          {children}
        </div>
      )}
    </div>
  );
}
