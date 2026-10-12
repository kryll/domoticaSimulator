import { useId, useState, type ReactNode } from 'react';

/** Leyendas de las capas, plegables para no tapar nodos. */
export function CollapsibleLegend({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <div className="flex flex-col items-end gap-1" data-export-ignore="">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-slate-200 bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-slate-600 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
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
